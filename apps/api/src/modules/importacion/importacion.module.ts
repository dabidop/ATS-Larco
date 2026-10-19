import { Module } from '@nestjs/common';

import { ImportacionController } from './importacion.controller';

/** Módulo de importación de datos (andamiaje de la Fase 1). */
@Module({
  controllers: [ImportacionController],
})
export class ImportacionModule {}
