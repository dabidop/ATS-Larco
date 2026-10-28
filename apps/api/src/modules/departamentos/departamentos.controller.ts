import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedRequest, AuthenticatedUser } from '../../common/guards/auth.guard';
import { ActualizarDepartamentoDto } from './dto/actualizar-coordinador.dto';
import type { DepartamentoResponseDto } from './dto/departamento.response';
import { DepartamentosService } from './departamentos.service';

/**
 * Pipe del parámetro `:id`: cualquier uuid sirve (no se restringe versión) y el
 * error sale como 400 con mensaje en español, no con el texto por defecto de
 * Nest en inglés. Se construye ANTES de la clase porque los decoradores de
 * parámetro se evalúan al definir el controlador (una `const` posterior sería
 * TDZ); los imports sí están elevados, así que `BadRequestException` ya existe.
 */
// Falso positivo de `no-useless-assignment` con decoradores legacy de TS: el
// valor SÍ se lee en `@Param('id', UUID_PARAM)` de `actualizar`. La regla solo
// lo marca cuando el pipe tiene UN único uso en la clase (con 2+ no lo hace,
// como en `PostulacionesController`); verificado empíricamente con eslint.
// eslint-disable-next-line no-useless-assignment
const UUID_PARAM = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El identificador del departamento debe ser un UUID válido'),
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
 * Controlador de los DEPARTAMENTOS de LARCO (Etapa 9, retroalimentación). El
 * prefijo `api/` lo añade el `setGlobalPrefix('api')` del bootstrap; la
 * autenticación y autorización son el `AuthGuard` + `RolesGuard` GLOBALES del
 * `AppModule`.
 *
 *  - `GET /api/departamentos` → catálogo de las 8 áreas con sus estadísticas.
 *    Lo consumen el formulario de candidatos/requerimientos (select de área) y
 *    la pantalla «Departamentos». Cualquier rol autenticado puede leerlo.
 *  - `PATCH /api/departamentos/:id` → cambia el COORDINADOR del área (rol
 *    `admin_rrhh` o `superusuario`). El catálogo es el seed de la migración
 *    009: aquí NO se crean ni se borran áreas.
 */
@Controller('departamentos')
export class DepartamentosController {
  constructor(private readonly service: DepartamentosService) {}

  /** Catálogo con conteos de candidatos y requerimientos por área. */
  @Get()
  listar(@Req() request: AuthenticatedRequest): Promise<DepartamentoResponseDto[]> {
    return this.service.listar(requireUser(request));
  }

  /** Cambia el coordinador del área → item actualizado (404 si no existe). */
  @Patch(':id')
  @Roles('admin_rrhh', 'superusuario')
  actualizar(
    @Param('id', UUID_PARAM) id: string,
    @Body() dto: ActualizarDepartamentoDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<DepartamentoResponseDto> {
    const usuario = requireUser(request);
    return this.service.actualizar(id, dto, usuario.sub);
  }
}
