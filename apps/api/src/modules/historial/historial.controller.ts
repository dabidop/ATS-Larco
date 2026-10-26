import { Controller, Get, Query } from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator';
import { AuditoriaService } from './auditoria.service';
import { AuditoriaQueryDto } from './dto/auditoria.query.dto';
import type { AuditoriaPageDto } from './dto/auditoria.response';

/**
 * Controlador de la BITÁCORA de auditoría (Etapa 9, retroalimentación). El
 * prefijo `api/` lo añade el `setGlobalPrefix('api')` del bootstrap; la
 * autenticación y autorización son el `AuthGuard` + `RolesGuard` GLOBALES del
 * `AppModule`.
 *
 * `GET /api/historial/auditoria` → página del `audit_log` (quién cambió qué,
 * cuándo), con filtros por tabla, actor, registro y rango de fechas. SOLO
 * `superusuario` (regla 7: la bitácora es visible para el rol máximo). El
 * placeholder `GET /api/historial/ping` de andamiaje desapareció: la ruta la
 * cubre la suite e2e real (`historial-auditoria.e2e.test.ts`).
 */
@Controller('historial')
export class HistorialController {
  constructor(private readonly auditoria: AuditoriaService) {}

  /** Página del log de auditoría con diff enmascarado (solo superusuario). */
  @Get('auditoria')
  @Roles('superusuario')
  listar(@Query() query: AuditoriaQueryDto): Promise<AuditoriaPageDto> {
    return this.auditoria.listar(query);
  }
}
