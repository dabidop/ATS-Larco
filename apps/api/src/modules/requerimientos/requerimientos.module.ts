import { Module } from '@nestjs/common';

import { RequerimientosController } from './requerimientos.controller';

/** Módulo de requerimientos de personal (andamiaje de la Fase 1). */
@Module({
  controllers: [RequerimientosController],
})
export class RequerimientosModule {}
