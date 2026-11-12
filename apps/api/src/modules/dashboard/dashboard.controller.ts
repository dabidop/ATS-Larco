import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/guards/auth.guard';

import { Roles } from '../../common/decorators/roles.decorator';
import type { DashboardResponseDto } from './dto/dashboard.response';
import { ListDashboardQueryDto } from './dto/list-dashboard-query.dto';
import { DashboardService } from './dashboard.service';

/**
 * Controlador del DASHBOARD de LARCO (Etapa 9, retroalimentación). El prefijo
 * `api/` lo añade el `setGlobalPrefix('api')` del bootstrap; la autenticación
 * y autorización son el `AuthGuard` + `RolesGuard` GLOBALES del `AppModule`.
 *
 * `GET /api/dashboard` → un único resumen (embudo, por-fase y requerimientos)
 * que la pantalla de inicio pinta de una vez. Todas las lecturas se hacen en
 * paralelo y sobre el MISMO instante, así los números son coherentes entre sí.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  /** Resumen operativo: candidatos en embudo + requerimientos + críticos. */
  @Get()
  @Roles('analista_seleccion', 'admin_rrhh', 'superusuario', 'lider_area')
  resumen(
    @Query() query: ListDashboardQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<DashboardResponseDto> {
    const user = request.user;
    if (user === undefined) {
      // AuthGuard is global; this is only a defensive type/runtime guard.
      throw new Error('Usuario autenticado no disponible');
    }
    return this.service.resumen(query, user);
  }
}
