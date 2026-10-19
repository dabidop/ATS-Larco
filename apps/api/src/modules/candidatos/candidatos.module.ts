import { Module } from '@nestjs/common';

import { CandidatosController } from './candidatos.controller';

/** Módulo de gestión de candidatos (andamiaje de la Fase 1). */
@Module({
  controllers: [CandidatosController],
})
export class CandidatosModule {}
