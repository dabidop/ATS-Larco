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
import { CreateRequerimientoDto } from './dto/create-requerimiento.dto';
import { ListRequerimientosQueryDto } from './dto/list-requerimientos-query.dto';
import type { RequerimientoResponseDto, RequerimientosPageDto } from './dto/requerimiento.response';
import { TransicionarRequerimientoDto } from './dto/transicionar-requerimiento.dto';
import { UpdateRequerimientoDto } from './dto/update-requerimiento.dto';
import { RequerimientosService } from './requerimientos.service';

/**
 * Pipe del parámetro `:id`: cualquier uuid sirve (no se restringe versión) y el
 * error sale como 400 con mensaje en español, no con el texto por defecto de
 * Nest en inglés.
 *
 * Se construye ANTES de la clase porque los decoradores de parámetro se
 * evalúan al definir el controlador: una `const` posterior sería TDZ.
 */
const UUID_PARAM = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El identificador del requerimiento debe ser un UUID válido'),
});

/**
 * Usuario verificado que `AuthGuard` inyectó en la request.
 *
 * El guard global garantiza que existe (sin él la petición ya respondió 401);
 * esta comprobación es solo para que TypeScript pueda tratar `request.user`
 * como definido.
 */
function requireUser(request: AuthenticatedRequest): AuthenticatedUser {
  if (request.user === undefined) {
    throw new UnauthorizedException('No autenticado: se requiere un token Bearer válido');
  }
  return request.user;
}

/**
 * Controlador de requerimientos de personal — API CRUD de las 5 secciones del
 * formulario (Fase 3, parte 3) y transiciones de estado (Fase 3, parte 4). El
 * prefijo `api/` lo añade el
 * `setGlobalPrefix('api')` del bootstrap; la autenticación y la autorización
 * son guards GLOBALES (`AuthGuard` + `RolesGuard`), así que aquí solo se
 * declaran los roles permitidos con `@Roles(...)`.
 *
 * Matriz RBAC de este controlador:
 * | Ruta                                      | Acceso                                                 |
 * |-------------------------------------------|--------------------------------------------------------|
 * | GET  /api/requerimientos/ping             | @Roles('admin_rrhh','lider_area')                      |
 * | POST /api/requerimientos                  | @Roles('admin_rrhh','lider_area')                      |
 * | GET  /api/requerimientos                  | autenticado (cualquier rol)                            |
 * | GET  /api/requerimientos/:id              | autenticado (cualquier rol)                            |
 * | PATCH /api/requerimientos/:id             | creador o @Roles('admin_rrhh')                         |
 * | POST /api/requerimientos/:id/transiciones | @Roles('admin_rrhh','analista_seleccion','lider_area') |
 *
 * SOLO LECTURA de estado en el CRUD: `estado` y `motivoRechazo` no se aceptan
 * en los cuerpos de POST/PATCH (los DTO no los declaran → 400 con
 * `forbidNonWhitelisted`). El estado SOLO cambia por la máquina de estados de
 * `POST /:id/transiciones` (parte 4), cuya matriz real de permisos
 * `origen → destino` por rol se aplica en el servicio —aquí `@Roles(...)`
 * solo es la puerta de entrada—.
 *
 * NO EXISTE `DELETE /api/requerimientos/:id` — decisión de diseño, no un
 * olvido: los requerimientos son documentos con trazabilidad para Gestión
 * Humana. Su ciclo termina en `cerrado` o `rechazado` (máquina de estados, y
 * la propia BD exige `motivo_rechazo` al rechazar), el histórico de auditoría
 * (`audit_log`, inmutable) debe poder reconstruirse y los procesos de
 * selección que la parte 5 enlazará apuntan al requerimiento. Por eso NADA se
 * borra: un DELETE físico rompería esas referencias.
 */
@Controller('requerimientos')
export class RequerimientosController {
  constructor(private readonly requerimientos: RequerimientosService) {}

  @Roles('admin_rrhh', 'lider_area')
  @Get('ping')
  ping() {
    return { modulo: 'requerimientos', status: 'placeholder' } as const;
  }

  /** Crea un requerimiento (201) con código `REQ-YYYY-NNN` y estado `pendiente`. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('admin_rrhh', 'lider_area')
  async create(
    @Body() body: CreateRequerimientoDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequerimientoResponseDto> {
    return this.requerimientos.create(body, requireUser(request).sub);
  }

  /** Listado paginado con filtros por `estado` y `jefatura` (cualquier rol). */
  @Get()
  async list(@Query() query: ListRequerimientosQueryDto): Promise<RequerimientosPageDto> {
    return this.requerimientos.list(query);
  }

  /** Detalle por id (uuid); 400 si el id no es uuid y 404 si no existe. */
  @Get(':id')
  async findOne(@Param('id', UUID_PARAM) id: string): Promise<RequerimientoResponseDto> {
    return this.requerimientos.findById(id);
  }

  /** Actualización parcial: solo en `pendiente` y solo creador o `admin_rrhh`. */
  @Patch(':id')
  async update(
    @Param('id', UUID_PARAM) id: string,
    @Body() body: UpdateRequerimientoDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequerimientoResponseDto> {
    return this.requerimientos.update(id, body, requireUser(request));
  }

  /**
   * Transición de la máquina de estados (parte 4) → 200 con el requerimiento
   * ACTUALIZADO (misma forma que el CRUD, no un sub-recurso).
   *
   * `@Roles(...)` es solo la puerta: los 3 roles del flujo llegan al servicio,
   * que aplica la matriz real `origen → destino` (409 estructural → 403 por
   * rol → 400 si falta motivo al rechazar). El guard global de throttling ya
   * cubre esta ruta; aquí no se duplica nada.
   */
  @Post(':id/transiciones')
  @HttpCode(HttpStatus.OK)
  @Roles('admin_rrhh', 'analista_seleccion', 'lider_area')
  async transicionar(
    @Param('id', UUID_PARAM) id: string,
    @Body() body: TransicionarRequerimientoDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequerimientoResponseDto> {
    return this.requerimientos.transicionar(id, body, requireUser(request));
  }
}
