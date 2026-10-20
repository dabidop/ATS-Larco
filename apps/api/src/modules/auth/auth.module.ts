import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import type { Env } from '../../config/env.validation';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Módulo de autenticación (Fase 2, parte 1): login, logout, refresh y me con
 * JWT firmados (HS256) de vigencia configurable (`JWT_TTL_HOURS`, 24 h por
 * defecto). Los guards de protección de rutas llegan en la parte 2.
 */
@Module({
  imports: [
    // JwtModule inyectable: secret y TTL se leen de la configuración YA
    // validada por zod (un JWT_SECRET ausente o corto detiene el arranque).
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: `${config.getOrThrow('JWT_TTL_HOURS')}h` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
