import { Module } from '@nestjs/common';

import { AntecedentesController } from './antecedentes.controller';

/** Módulo de verificación de antecedentes (andamiaje de la Fase 1). */
@Module({
  controllers: [AntecedentesController],
})
export class AntecedentesModule {}
