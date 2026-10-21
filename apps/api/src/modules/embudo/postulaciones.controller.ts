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
  UnauthorizedException,
} from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest, AuthenticatedUser } from '../../common/guards/auth.guard';
import { CreatePostulacionDto } from './dto/create-postulacion.dto';
import { DescartarPostulacionDto } from './dto/descartar-postulacion.dto';
import { ListPostulacionesQueryDto } from './dto/list-postulaciones-query.dto';
import { MoverFaseDto } from './dto/mover-fase.dto';
import type { PostulacionResponseDto, PostulacionesPageDto } from './dto/postulacion.response';
import type { EntradaHistorialPostulacionDto } from './postulaciones.mapper';
import { PostulacionesService } from './postulaciones.service';

/**
 * Pipe del parámetro `:id`: cualquier uuid sirve (no se restringe versión) y el
 * error sale como 400 con mensaje en español, no con el texto por defecto de
 * Nest en inglés. Se construye ANTES de la clase porque los decoradores de
 * parámetro se evalúan al definir el controlador (una `const` posterior sería
 * TDZ); los imports sí están elevados, así que `BadRequestException` ya existe.
 */
const UUID_PARAM = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El identificador de la postulación debe ser un UUID válido'),
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
 * Controlador de las POSTULACIONES — el embudo de selección por 5 fases
 * (Fase 5, parte backend). El prefijo `api/` lo añade el
 * `setGlobalPrefix('api')` del bootstrap; la autenticación y autorización son
 * guards GLOBALES (`AuthGuard` + `RolesGuard`), así que aquí solo se declaran
 * los roles permitidos con `@Roles(...)`.
 *
 * Las 5 fases del tablero, EN ORDEN:
 * `preseleccion → antecedentes → entrevistas → proveedor_externo → contratacion`
 * (la fuente de verdad del orden vive en `postulaciones-fases.ts` y en el ENUM
 * `fase_postulacion` de la migración 007).
 *
 * Matriz RBAC de este controlador:
 * | Ruta                              | Acceso                                    |
 * |-----------------------------------|-------------------------------------------|
 * | POST /api/postulaciones           | @Roles('analista_seleccion','admin_rrhh') |
 * | GET  /api/postulaciones           | autenticado (cualquier rol)               |
 * | GET  /api/postulaciones/:id       | autenticado (cualquier rol)               |
 * | PATCH /api/postulaciones/:id/fase | @Roles('analista_seleccion','admin_rrhh') |
 * | POST /api/postulaciones/:id/descarte | @Roles('analista_seleccion','admin_rrhh') |
 * | GET  /api/postulaciones/:id/historial | autenticado (cualquier rol)           |
 *
 * El cliente NUNCA escribe `estado` ni `motivoDescarte` directamente: la fase
 * la mueve `PATCH /:id/fase` (un paso adyacente; `contratacion` ⇒
 * `contratado`) y el descarte va por `POST /:id/descarte` con motivo
 * obligatorio. Todos los fallos de negocio (duplicado, requerimiento fuera de
 * `en_proceso`, salto de fase, movimiento sobre un terminal) son 409 con
 * mensaje claro; los de forma son 400 del ValidationPipe global.
 *
 * El andamiaje de la Fase 1 SE MANTIENE: `GET /api/embudo/ping` sigue en
 * `EmbudoController` (lo consume `modules.e2e.test.ts`); este controlador
 * vive bajo `/api/postulaciones`.
 */
@Controller('postulaciones')
export class PostulacionesController {
  constructor(private readonly postulaciones: PostulacionesService) {}

  /**
   * Registra una postulación → **201**, SIEMPRE en `preseleccion`/`activa`.
   *
   * El cuerpo solo trae `candidatoId` y `requerimientoId`; la fase y el estado
   * los decide el servidor (y los defaults de las columnas, en BD).
   *
   * Respuestas: **404** candidato o requerimiento inexistente · **409**
   * requerimiento fuera de `en_proceso` (la selección se ejecuta durante la
   * fase activa del requerimiento) o postulación YA existente · **403** sin
   * los roles permitidos.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('analista_seleccion', 'admin_rrhh')
  async crear(
    @Body() body: CreatePostulacionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PostulacionResponseDto> {
    return this.postulaciones.crear(body, requireUser(request).sub);
  }

  /**
   * Listado paginado `{ items, total, page, limit }` (page 1, limit 1-100 por
   * defecto 50) con filtros combinables `requerimientoId`, `candidatoId`,
   * `fase` y `estado`, ordenado `created_at DESC`. Cualquier rol autenticado.
   *
   * Para el tablero Kanban el cliente pide `?requerimientoId=...` y agrupa los
   * `items` por su `fase` (el orden de las columnas lo conoce el frontend).
   */
  @Get()
  async listar(@Query() query: ListPostulacionesQueryDto): Promise<PostulacionesPageDto> {
    return this.postulaciones.listar(query);
  }

  /** Detalle por id (uuid); 400 si el id no es uuid y 404 si no existe. */
  @Get(':id')
  async findOne(@Param('id', UUID_PARAM) id: string): Promise<PostulacionResponseDto> {
    return this.postulaciones.findById(id);
  }

  /**
   * Mueve la postulación UN paso (adelante o atrás) → **200** con la fila
   * actualizada.
   *
   * Respuestas: **404** inexistente · **409** estado terminal (`contratado` o
   * `descartado`) · **409** fase destino igual a la actual · **409** salto de
   * fase («Solo se puede mover un paso…») · **403** sin los roles permitidos.
   *
   * Si el destino es `contratacion`, la postulación queda `contratado`
   * (terminal): llegar allí ES contratar.
   */
  @Patch(':id/fase')
  @HttpCode(HttpStatus.OK)
  @Roles('analista_seleccion', 'admin_rrhh')
  async cambiarFase(
    @Param('id', UUID_PARAM) id: string,
    @Body() body: MoverFaseDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PostulacionResponseDto> {
    return this.postulaciones.cambiarFase(id, body, requireUser(request).sub);
  }

  /**
   * Descarta la postulación desde CUALQUIER fase → **200** con estado
   * `descartado` (terminal) y el motivo RECORTADO.
   *
   * Respuestas: **400** motivo ausente, vacío o solo espacios («El motivo de
   * descarte es obligatorio») · **404** inexistente · **409** ya terminal ·
   * **403** sin los roles permitidos. En BD el CHECK
   * `postulaciones_descarte_check` es la red de seguridad final: un descarte
   * sin motivo es imposible en PostgreSQL.
   */
  @Post(':id/descarte')
  @HttpCode(HttpStatus.OK)
  @Roles('analista_seleccion', 'admin_rrhh')
  async descartar(
    @Param('id', UUID_PARAM) id: string,
    @Body() body: DescartarPostulacionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PostulacionResponseDto> {
    return this.postulaciones.descartar(id, body, requireUser(request).sub);
  }

  /**
   * Historial de cambios de la postulación desde `audit_log` (máx. 200
   * entradas, `created_at DESC`), cualquier rol autenticado.
   *
   * Cada entrada trae `id`, `accion` (INSERT/UPDATE), `fecha` (ISO 8601),
   * `usuario` (uuid crudo de `changed_by`) + `usuarioEmail` (LEFT JOIN a
   * `users`) y `campos` (los 3 campos de negocio que cambiaron: `fase`,
   * `estado`, `motivoDescarte`). La tabla no tiene PII, pero las claves
   * internas (FKs, `created_by`, timestamps) NO se exponen: la decisión está
   * documentada en `postulaciones.mapper.ts`.
   */
  @Get(':id/historial')
  async historial(@Param('id', UUID_PARAM) id: string): Promise<EntradaHistorialPostulacionDto[]> {
    return this.postulaciones.historial(id);
  }
}
