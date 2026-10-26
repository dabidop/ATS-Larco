import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest, AuthenticatedUser } from '../../common/guards/auth.guard';
import { ArchivoSubido } from '../uploads/archivos-cv.service';
import { LimiteTamanoInterceptor } from '../uploads/limite-tamano.interceptor';
import type { ImportarHvsResponseDto } from './dto/importar-hvs.response';
import { ImportarHvsDto } from './dto/importar-hvs.dto';
import { ImportacionService } from './importacion.service';

/** Máximo de HVs por lote (Etapa 9: ≤ 50 PDFs, ≤ 5 MB cada uno). */
const LIMITE_ARCHIVOS = 50;

/** Mismo límite por archivo que la subida individual de CV (5 MB). */
const LIMITE_TAMANO_CV = 5 * 1024 * 1024;

/**
 * Usuario verificado que `AuthGuard` inyectó en la request. El guard global
 * garantiza que existe; esta comprobación es para que TypeScript lo trate como
 * definido.
 */
function requireUser(request: AuthenticatedRequest): AuthenticatedUser {
  if (request.user === undefined) {
    throw new UnauthorizedException('No autenticado: se requiere un token Bearer válido');
  }
  return request.user;
}

/**
 * Controlador de la IMPORTACIÓN MASIVA de HVs (Etapa 9, retroalimentación). El
 * prefijo `api/` lo añade el `setGlobalPrefix('api')` del bootstrap; la
 * autenticación y autorización son el `AuthGuard` + `RolesGuard` GLOBALES del
 * `AppModule`.
 *
 * `POST /api/importacion/hvs` → multipart con el campo `archivos` (≤ 50 PDFs)
 * y el campo texto `departamentoId` (destino del lote). Devuelve un resumen
 * con UN resultado por archivo. Los interceptores van en este orden porque
 * Nest los encadena de fuera hacia dentro y los límites de Multer se aplican
 * al PARSEAR el multipart (antes del manejador):
 *
 *  1. `LimiteTamanoInterceptor` (de uploads) → 413 en español si un PDF supera
 *     5 MB.
 *  2. `FilesInterceptor('archivos', 50)` → `memoryStorage` por defecto; el
 *     nombre del fichero llega en UTF-8 (`defParamCharset: 'utf8'`, tildes/ñ).
 *
 * La validación de que cada archivo ES un PDF (magic bytes) vive en el
 * servicio: un .docx suelto no rechaza el lote, se reporta como fallo de SU
 * archivo.
 */
@Controller('importacion')
export class ImportacionController {
  constructor(private readonly service: ImportacionService) {}

  /** Importa un lote de HVs (PDF) → { procesados, creados, fallidos, ... }. */
  @Post('hvs')
  @HttpCode(HttpStatus.OK)
  @Roles('admin_rrhh', 'superusuario', 'analista_seleccion')
  @UseInterceptors(
    LimiteTamanoInterceptor,
    FilesInterceptor('archivos', LIMITE_ARCHIVOS, {
      limits: { fileSize: LIMITE_TAMANO_CV, files: LIMITE_ARCHIVOS },
      // El nombre del fichero llega en UTF-8 (tildes/ñ); el default de Multer
      // es latin1 y produciría «mojibake» en `originalname`.
      defParamCharset: 'utf8',
    }),
  )
  importarHvs(
    @Body() dto: ImportarHvsDto,
    @Req() request: AuthenticatedRequest,
    @UploadedFiles() archivos?: ArchivoSubido[],
  ): Promise<ImportarHvsResponseDto> {
    const usuario = requireUser(request);
    return this.service.importar(archivos ?? [], dto.departamentoId, usuario.sub);
  }
}
