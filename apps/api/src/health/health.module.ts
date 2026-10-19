import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/** Módulo de salud (health checks) de la API. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
