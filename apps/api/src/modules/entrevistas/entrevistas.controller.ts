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
import { ActualizarEntrevistaDto } from './dto/actualizar-entrevista.dto';
import { CrearEntrevistaDto } from './dto/crear-entrevista.dto';
import type { EntrevistaResponseDto } from './dto/entrevista.response';
import { ListarEntrevistasQueryDto } from './dto/listar-entrevistas-query.dto';
import { EntrevistasService } from './entrevistas.service';

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
    new BadRequestException('El identificador de la entrevista debe ser un UUID válido'),
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
 * Controlador de las ENTREVISTAS de LARCO (Etapa 9, retroalimentación). El
 * prefijo `api/` lo añade el `setGlobalPrefix('api')` del bootstrap; la
 * autenticación y autorización son el `AuthGuard` + `RolesGuard` GLOBALES del
 * `AppModule`.
 *
 * | Ruta                       | Roles                                            |
 * |----------------------------|--------------------------------------------------|
 * | GET /api/entrevistas       | analista_seleccion, admin_rrhh, superusuario     |
 * | POST /api/entrevistas      | analista_seleccion, admin_rrhh, superusuario     |
 * | PATCH /api/entrevistas/:id | analista_seleccion, admin_rrhh, superusuario     |
 *
 * El módulo «ping» de andamiaje de la Fase 1 desapareció: la ruta la cubre
 * ahora la suite e2e real (`entrevistas.e2e.test.ts`).
 */
@Controller('entrevistas')
export class EntrevistasController {
  constructor(private readonly service: EntrevistasService) {}

  /** Agenda filtrable (fechas, estado, postulación o candidato). */
  @Get()
  @Roles('analista_seleccion', 'admin_rrhh', 'superusuario')
  listar(@Query() query: ListarEntrevistasQueryDto): Promise<EntrevistaResponseDto[]> {
    return this.service.listar(query);
  }

  /** Agendar una entrevista sobre una postulación activa (404/409 según caso). */
  @Post()
  @Roles('analista_seleccion', 'admin_rrhh', 'superusuario')
  crear(
    @Body() dto: CrearEntrevistaDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<EntrevistaResponseDto> {
    const usuario = requireUser(request);
    return this.service.crear(dto, usuario.sub);
  }

  /** Editar fecha/hora/tipo/entrevistador/estado/notas (solo los informados). */
  @Patch(':id')
  @Roles('analista_seleccion', 'admin_rrhh', 'superusuario')
  @HttpCode(HttpStatus.OK)
  actualizar(
    @Param('id', UUID_PARAM) id: string,
    @Body() dto: ActualizarEntrevistaDto,
  ): Promise<EntrevistaResponseDto> {
    return this.service.actualizar(id, dto);
  }
}
