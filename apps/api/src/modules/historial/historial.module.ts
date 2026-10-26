import { Module } from '@nestjs/common';

import { AuditoriaService } from './auditoria.service';
import { HistorialController } from './historial.controller';

/**
 * Módulo de la BITÁCORA de auditoría de LARCO (Etapa 9, retroalimentación).
 *
 * Lector puro de `audit_log` (lo escriben SOLO los triggers de cada tabla) con
 * el pool `pg` GLOBAL (`DatabaseModule` es `@Global`, igual que en el embudo,
 * así que no se importa aquí). El placeholder de andamiaje de la Fase 1 se
 * reemplazó por la implementación real.
 */
@Module({
  controllers: [HistorialController],
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class HistorialModule {}
