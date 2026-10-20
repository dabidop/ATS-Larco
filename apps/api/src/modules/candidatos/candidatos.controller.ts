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
import { CandidatosService } from './candidatos.service';
import type { CandidatoResponseDto, CandidatosPageDto } from './dto/candidato.response';
import { CreateCandidatoDto } from './dto/create-candidato.dto';
import { ListCandidatosQueryDto } from './dto/list-candidatos-query.dto';
import { UpdateCandidatoDto } from './dto/update-candidato.dto';

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
 * | Ruta                    | Acceso                                     |
 * |-------------------------|--------------------------------------------|
 * | GET  /api/candidatos/ping | autenticado (cualquier rol)              |
 * | POST /api/candidatos    | @Roles('analista_seleccion','admin_rrhh')  |
 * | GET  /api/candidatos    | autenticado (cualquier rol)                |
 * | GET  /api/candidatos/:id| autenticado (cualquier rol)                |
 * | PATCH /api/candidatos/:id | creador o @Roles('admin_rrhh') (en servicio) |
 *
 * La PII (cédula y teléfono) se recibe en claro, se CIFRA al persistir y se
 * devuelve DESCIFRADA al cliente autenticado. El hash interno `cedulaHash` NUNCA
 * sale por aquí.
 *
 * NO EXISTE `DELETE /api/candidatos/:id` en esta fase: los candidatos son datos
 * con trazabilidad para Gestión Humana y el histórico de auditoría
 * (`audit_log`, inmutable) debe poder reconstruirse; el borrado lógico llegará
 * más adelante si el plan lo requiere.
 */
@Controller('candidatos')
export class CandidatosController {
  constructor(private readonly candidatos: CandidatosService) {}

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
}
