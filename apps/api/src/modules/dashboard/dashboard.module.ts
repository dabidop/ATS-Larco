import { Module } from '@nestjs/common';

import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Módulo del DASHBOARD de LARCO (Etapa 9, retroalimentación).
 *
 * Lector puro de `candidatos`, `postulaciones` y `requerimientos` (el pool `pg`
 * GLOBAL `DatabaseModule` no se importa aquí: es `@Global`). Sin escrituras ni
 * migraciones propias.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
