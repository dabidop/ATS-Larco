import { Module } from '@nestjs/common';

import { HistorialController } from './historial.controller';

/** Módulo de historial del candidato y auditoría (andamiaje de la Fase 1). */
@Module({
  controllers: [HistorialController],
})
export class HistorialModule {}
