import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { CandidatosService, type EntradaHistorialDto } from './candidatos.service';
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
 * | Ruta                                       | Acceso                                                     |
 * |--------------------------------------------|------------------------------------------------------------|
 * | GET  /api/candidatos/ping                  | autenticado (cualquier rol)                                |
 * | POST /api/candidatos                       | @Roles('analista_seleccion','admin_rrhh','superusuario')   |
 * | GET  /api/candidatos                       | autenticado (cualquier rol)                                |
 * | GET  /api/candidatos/:id                   | autenticado (cualquier rol)                                |
 * | GET  /api/candidatos/:id/historial         | autenticado (cualquier rol)                                |
 * | PATCH /api/candidatos/:id                  | creador o @Roles('admin_rrhh','superusuario') (en servicio) |
 * | DELETE /api/candidatos/:id                  | creador o `superusuario` (IT), sin postulaciones (servicio) |
 * | POST /api/candidatos/:id/archivos          | @Roles('analista_seleccion','admin_rrhh','superusuario')   |
 * | GET  /api/candidatos/:id/archivos          | autenticado (cualquier rol)                                |
 * | GET  /api/candidatos/:id/archivos/:aid/descarga | autenticado (cualquier rol)                           |
 *
 * `superusuario` (IT, migración 008) hereda TODO el poder de `admin_rrhh`
 * sobre los candidatos (Etapa 8B): los crea, los edita aunque no los haya
 * creado y les adjunta CVs.
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
 * `DELETE /api/candidatos/:id` existe para DESHACER UN ERROR de captura, con
 * las reglas decididas en el SERVICIO (sin `@Roles`: no es un permiso de rol
 * sino de PROPIEDAD de la fila):
 *  - **403** si no es el `superusuario` (IT) ni el que CREÓ el candidato;
 *  - **409** si está ligado a un requerimiento (tiene postulaciones): el
 *    histórico de selección NO se toca;
 *  - **404** si no existe; **204** si se borró.
 * El borrado deja rastro en `audit_log` (el trigger `candidatos_audit_log`
 * audita INSERT/UPDATE/DELETE desde la migración 011) y elimina en cascada
 * sus filas de `archivos_cv`; los FICHEROS en disco se RETIENEN (dedup por
 * sha256: pueden estar compartidos con otro candidato, misma filosofía de
 * retención de `AlmacenamientoService`).
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

  /** Crea un candidato (201) con la PII cifrada. Solo selección, admin RRHH y superusuario. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('analista_seleccion', 'admin_rrhh', 'superusuario')
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

  /**
   * Historial de cambios del candidato desde `audit_log` (Fase 4, parte 3).
   *
   * Acceso: cualquier rol autenticado (como `GET /:id`). Respuestas:
   *  - **400** si el id no es un uuid (mismo `UUID_PARAM` que el detalle).
   *  - **404** si el candidato no existe (validado en BD ANTES de leer el log).
   *  - **200** con las últimas 200 entradas ordenadas `created_at DESC`.
   *
   * El trigger `audit_fila()` (migraciones 003/004) es quien ESCRIBE
   * `audit_log`; aquí SOLO se lee. Cada entrada trae `id`, `accion`
   * (INSERT/UPDATE), `fecha` (ISO 8601), `usuario` (uuid crudo de
   * `changed_by`) + `usuarioEmail` (LEFT JOIN a `users`, para legibilidad) y
   * `campos` (los que cambiaron; vacíos `antes: null` en el alta). La PII
   * cifrada (`cedula`, `telefono`) aparece SIEMPRE enmascarada como `'***'` y
   * `cedula_hash` ni se lista: el historial JAMÁS descifra.
   */
  @Get(':id/historial')
  async historial(@Param('id', UUID_PARAM) id: string): Promise<EntradaHistorialDto[]> {
    return this.candidatos.historial(id);
  }

  /** Actualización parcial: solo creador, `admin_rrhh` o `superusuario` (decisión en el servicio). */
  @Patch(':id')
  async update(
    @Param('id', UUID_PARAM) id: string,
    @Body() body: UpdateCandidatoDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CandidatoResponseDto> {
    return this.candidatos.update(id, body, requireUser(request));
  }

  /**
   * Elimina un candidato capturado por ERROR → **204**.
   *
   * Sin `@Roles(...)`: la regla es de PROPIEDAD, no de rol y vive en el
   * servicio — **403** si no es el `superusuario` (IT) ni el creador, **409**
   * si tiene postulaciones (está ligado a un requerimiento), **404** si no
   * existe. Tampoco se oculta el botón por rol en el front: quien no puede
   * borrarlo recibe el 403 con mensaje en español.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(
    @Param('id', UUID_PARAM) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.candidatos.eliminar(id, requireUser(request));
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
  @Roles('analista_seleccion', 'admin_rrhh', 'superusuario')
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
