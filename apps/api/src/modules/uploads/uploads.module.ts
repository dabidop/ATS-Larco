import { Module } from '@nestjs/common';

import { UploadsController } from './uploads.controller';

/** Módulo de carga de archivos (andamiaje de la Fase 1). */
@Module({
  controllers: [UploadsController],
})
export class UploadsModule {}
