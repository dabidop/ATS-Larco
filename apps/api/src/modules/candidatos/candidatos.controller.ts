import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest, AuthenticatedUser } from '../../common/guards/auth.guard';
import type { ArchivoCvResponseDto } from '../uploads/dto/archivo-cv.response';
import type { ArchivoSubido } from '../uploads/archivos-cv.service';
import { ArchivosCvService } from '../uploads/archivos-cv.service';
import { attachmentContentDisposition } from '../uploads/content-disposition';
import { LimiteTamanoInterceptor } from '../uploads/limite-tamano.interceptor';
import { CandidatosService } from './candidatos.service';
import type { CandidatoResponseDto, CandidatosPageDto } from './dto/candidato.response';
import { CreateCandidatoDto } from './dto/create-candidato.dto';
import { ListCandidatosQueryDto } from './dto/list-candidatos-query.dto';
import { UpdateCandidatoDto } from './dto/update-candidato.dto';

/**
 * Tamaño máximo de un CV subido: 5 MB en bytes (límite de Multer, que responde
 * 413 vía `LimiteTamanoInterceptor`).
 */
const LIMITE_TAMANO_CV = 5 * 1024 * 1024;

/**
 * Pipe del parámetro `:id`: cualquier uuid sirve (no se restringe versión) y el
 * error sale como 400 con mensaje en español, no con el texto por defecto de
 * Nest en inglés. Se construye ANTES de la clase porque los decoradores de
 * parámetro se evalúan al definir el controlador (una `const` posterior sería
 * TDZ); los imports sí están elevados, así que `BadRequestException` ya existe.
 */
const UUID_PARAM = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El identificador del candidato debe ser un UUID válido'),
});

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
 * Controlador de candidatos — API CRUD con PII cifrada (Fase 4, parte 1). El
 * prefijo `api/` lo añade el `setGlobalPrefix('api')` del bootstrap; la
 * autenticación y autorización son guards GLOBALES (`AuthGuard` + `RolesGuard`),
 * así que aquí solo se declaran los roles permitidos con `@Roles(...)`.
 *
 * Matriz RBAC de este controlador:
 * | Ruta                                       | Acceso                                     |
 * |--------------------------------------------|--------------------------------------------|
 * | GET  /api/candidatos/ping                  | autenticado (cualquier rol)                |
 * | POST /api/candidatos                       | @Roles('analista_seleccion','admin_rrhh')  |
 * | GET  /api/candidatos                       | autenticado (cualquier rol)                |
 * | GET  /api/candidatos/:id                   | autenticado (cualquier rol)                |
 * | PATCH /api/candidatos/:id                  | creador o @Roles('admin_rrhh') (en servicio) |
 * | POST /api/candidatos/:id/archivos          | @Roles('analista_seleccion','admin_rrhh')  |
 * | GET  /api/candidatos/:id/archivos          | autenticado (cualquier rol)                |
 * | GET  /api/candidatos/:id/archivos/:aid/descarga | autenticado (cualquier rol)           |
 *
 * ARCHIVOS DE CV (Fase 4, parte 2): la lógica vive en `ArchivosCvService`
 * (módulo `uploads`); aquí solo se declara la puerta HTTP: multipart con
 * `FileInterceptor('file')` limitado a 5 MB, validación del candidato y de los
 * magic bytes dentro del servicio, y la descarga como `StreamableFile` con el
 * MIME real de la fila y `Content-Disposition` UTF-8 (tildes/ñ). El
 * `LIMIT_FILE_SIZE` de Multer lo traduce `LimiteTamanoInterceptor` a un 413
 * con mensaje en español (un `try/catch` del manejador NO lo vería: el error
 * ocurre al parsear el multipart, antes de ejecutar la ruta).
 *
 * La PII (cédula y teléfono) se recibe en claro, se CIFRA al persistir y se
 * devuelve DESCIFRADA al cliente autenticado. El hash interno `cedulaHash` NUNCA
 * sale por aquí.
 *
 * NO EXISTE `DELETE /api/candidatos/:id` en esta fase: los candidatos son datos
 * con trazabilidad para Gestión Humana y el histórico de auditoría
 * (`audit_log`, inmutable) debe poder reconstruirse; el borrado lógico llegará
 * más adelante si el plan lo requiere. En consecuencia TAMPOCO hay borrado de
 * archivos: los CVs subidos se RETIENAN (misma filosofía que `requerimientos`;
 * ver la decisión de retención documentada en `AlmacenamientoService`).
 */
@Controller('candidatos')
export class CandidatosController {
  constructor(
    private readonly candidatos: CandidatosService,
    private readonly archivos: ArchivosCvService,
  ) {}

  /** Andamiaje de la Fase 1 (lo consume `modules.e2e.test.ts`). */
  @Get('ping')
  ping() {
    return { modulo: 'candidatos', status: 'placeholder' } as const;
  }

  /** Crea un candidato (201) con la PII cifrada. Solo selección y admin RRHH. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('analista_seleccion', 'admin_rrhh')
  async create(
    @Body() body: CreateCandidatoDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CandidatoResponseDto> {
    return this.candidatos.create(body, requireUser(request).sub);
  }

  /** Listado paginado con filtros `q` (parcial) y `cedula` (exacta) — cualquier rol. */
  @Get()
  async list(@Query() query: ListCandidatosQueryDto): Promise<CandidatosPageDto> {
    return this.candidatos.list(query);
  }

  /** Detalle por id (uuid); 400 si el id no es uuid y 404 si no existe. */
  @Get(':id')
  async findOne(@Param('id', UUID_PARAM) id: string): Promise<CandidatoResponseDto> {
    return this.candidatos.findById(id);
  }

  /** Actualización parcial: solo creador o `admin_rrhh` (decisión en el servicio). */
  @Patch(':id')
  async update(
    @Param('id', UUID_PARAM) id: string,
    @Body() body: UpdateCandidatoDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CandidatoResponseDto> {
    return this.candidatos.update(id, body, requireUser(request));
  }

  // ───────────────────────── archivos de CV (Fase 4, parte 2) ─────────────────────────

  /**
   * Adjunta un CV al candidato → **201** con metadatos
   * (`{ id, filenameOriginal, mimeType, sizeBytes, sha256, candidatoId, createdAt }`).
   *
   * Multipart `file` (≤ 5 MB, `memoryStorage`). El `sha256` SÍ se expone: es un
   * dato de INTEGRIDAD del propio fichero, no PII; la ruta en disco, en cambio,
   * nunca sale.
   *
   * Respuestas: **404** candidato inexistente · **400** sin archivo o tipo no
   * permitido (magic bytes) · **413** más de 5 MB (Multer) · **409** contenido
   * ya adjunto a ESTE candidato · **403** sin los roles permitidos.
   *
   * El interceptor de límite va PRIMERO en `@UseInterceptors(...)`: Nest encadena
   * los interceptors en orden y el primero es el más externo, así que envuelve al
   * `FileInterceptor` y puede traducir su error (ver `LimiteTamanoInterceptor`).
   */
  @Post(':id/archivos')
  @HttpCode(HttpStatus.CREATED)
  @Roles('analista_seleccion', 'admin_rrhh')
  @UseInterceptors(
    LimiteTamanoInterceptor,
    FileInterceptor('file', {
      limits: { fileSize: LIMITE_TAMANO_CV },
      // El nombre del fichero llega en UTF-8 (tildes/ñ); el default de Multer
      // es latin1 y produciría «mojibake» en `originalname`.
      defParamCharset: 'utf8',
    }),
  )
  async uploadFile(
    @Param('id', UUID_PARAM) id: string,
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: ArchivoSubido,
  ): Promise<ArchivoCvResponseDto> {
    if (file === undefined) {
      throw new BadRequestException(
        'Falta el archivo: envía el CV en el campo "file" (multipart/form-data)',
      );
    }
    return this.archivos.subir(id, file, requireUser(request).sub);
  }

  /** Metadatos de los archivos del candidato, más recientes primero (cualquier rol). */
  @Get(':id/archivos')
  async listFiles(@Param('id', UUID_PARAM) id: string): Promise<ArchivoCvResponseDto[]> {
    return this.archivos.listar(id);
  }

  /**
   * Descarga autorizada de un CV (cualquier rol autenticado).
   *
   *  - **200** con los bytes EXACTOS, `Content-Type` real de la fila (derivado
   *    de los magic bytes) y `Content-Disposition: attachment` con el nombre
   *    original (ASCII de fallback + `filename*=UTF-8''…` para tildes y ñ).
   *  - **404** si el archivo no existe o NO pertenece al candidato de la ruta.
   *  - **500** si la fila existe pero el fichero ya no está en disco
   *    («Archivo corrupto en almacenamiento»: inconsistencia nuestra, no del
   *    cliente, por eso no es un 404).
   *
   * `StreamableFile` entrega `Content-Length` y las cabeceras sin pisar las que
   * ya estuvieran puestas; los errores siguen al filtro global (aún no se han
   * enviado cabeceras, porque los bytes se leen ANTES de construirlo).
   */
  @Get(':id/archivos/:archivoId/descarga')
  async downloadFile(
    @Param('id', UUID_PARAM) id: string,
    @Param('archivoId', UUID_PARAM) archivoId: string,
  ): Promise<StreamableFile> {
    const { archivo, contenido } = await this.archivos.descargar(id, archivoId);
    return new StreamableFile(contenido, {
      type: archivo.mimeType,
      disposition: attachmentContentDisposition(archivo.filenameOriginal),
    });
  }
}
