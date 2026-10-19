import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';

/** Módulo de autenticación y autorización (andamiaje de la Fase 1). */
@Module({
  controllers: [AuthController],
})
export class AuthModule {}
