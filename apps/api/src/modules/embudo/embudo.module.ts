import { Module } from '@nestjs/common';

import { EmbudoController } from './embudo.controller';

/** Módulo del embudo de selección por fases (andamiaje de la Fase 1). */
@Module({
  controllers: [EmbudoController],
})
export class EmbudoModule {}
