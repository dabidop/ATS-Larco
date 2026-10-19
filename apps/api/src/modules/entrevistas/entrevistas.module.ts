import { Module } from '@nestjs/common';

import { EntrevistasController } from './entrevistas.controller';

/** Módulo de entrevistas y evaluaciones (andamiaje de la Fase 1). */
@Module({
  controllers: [EntrevistasController],
})
export class EntrevistasModule {}
