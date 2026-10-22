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
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { ListUsuariosQueryDto } from './dto/list-usuarios-query.dto';
import type { UsuarioResponseDto, UsuariosPageDto } from './dto/usuario.response';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { UsuariosService } from './usuarios.service';

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
    new BadRequestException('El identificador del usuario debe ser un UUID válido'),
});

/**
 * Usuario verificado que `AuthGuard` inyectó en la request. El guard global
 * garantiza que existe (sin él la petición ya respondió 401); esta
 * comprobación es solo para que TypeScript pueda tratar `request.user` como
 * definido.
 */
function requireUser(request: AuthenticatedRequest): AuthenticatedUser {
  if (request.user === undefined) {
    throw new UnauthorizedException('No autenticado: se requiere un token Bearer válido');
  }
  return request.user;
}

/**
 * Controlador de USUARIOS — gestión de cuentas, roles y contraseñas (Etapa 8B).
 *
 * El prefijo `api/` lo añade el `setGlobalPrefix('api')` del bootstrap; la
 * autenticación y la autorización son guards GLOBALES (`AuthGuard` +
 * `RolesGuard`), así que aquí solo se declaran los roles permitidos.
 *
 * EXCLUSIVIDAD DEL SUPERUSUARIO: RRHH NO gestiona usuarios (decisión de
 * negocio de la Etapa 8B). Los 4 endpoints exigen `@Roles('superusuario')`:
 * cualquier otro rol —incluido `admin_rrhh`— recibe 403.
 *
 * Matriz RBAC de este controlador:
 * | Ruta                  | Acceso                    |
 * |-----------------------|---------------------------|
 * | GET    /api/usuarios  | @Roles('superusuario')    |
 * | POST   /api/usuarios  | @Roles('superusuario')    |
 * | GET    /api/usuarios/:id | @Roles('superusuario')  |
 * | PATCH  /api/usuarios/:id | @Roles('superusuario')  |
 *
 * Las respuestas NUNCA incluyen `password_hash` (la forma pública está fijada
 * en `dto/usuario.response.ts`) y el `PATCH` jamás acepta `email` ni `nombre`
 * (el DTO no los declara → 400 con `forbidNonWhitelisted`).
 */
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  /**
   * Listado paginado `{ items, total, page, limit }` (page 1, limit 1-100 por
   * defecto 20) con filtros combinables `q` (ILIKE sobre nombre/email) y `rol`.
   */
  @Get()
  @Roles('superusuario')
  async listar(@Query() query: ListUsuariosQueryDto): Promise<UsuariosPageDto> {
    return this.usuarios.listar(query);
  }

  /**
   * Crea un usuario → **201** con la forma pública completa.
   *
   * `email` llega normalizado a minúsculas al servicio; duplicado → **409**;
   * `password` (< 8) o `rol` fuera de la lista → **400** del ValidationPipe.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('superusuario')
  async crear(
    @Body() body: CreateUsuarioDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<UsuarioResponseDto> {
    return this.usuarios.crear(body, requireUser(request).sub);
  }

  /** Detalle por id (uuid); 400 si el id no es uuid y 404 si no existe. */
  @Get(':id')
  @Roles('superusuario')
  async findOne(@Param('id', UUID_PARAM) id: string): Promise<UsuarioResponseDto> {
    return this.usuarios.findById(id);
  }

  /**
   * Actualización parcial (`activo`, `rol`, `password`) → **200**.
   *
   * Reglas de negocio (todas en el servicio): **400** sin ningún campo,
   * **409** al desactivarse a sí mismo o cambiarse el propio rol, **409** si
   * no queda ningún `superusuario` activo. La contraseña nueva se hashea con
   * scrypt y NUNCA se devuelve.
   */
  @Patch(':id')
  @Roles('superusuario')
  async actualizar(
    @Param('id', UUID_PARAM) id: string,
    @Body() body: UpdateUsuarioDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<UsuarioResponseDto> {
    return this.usuarios.actualizar(id, body, requireUser(request).sub);
  }
}
