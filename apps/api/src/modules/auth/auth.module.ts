import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import type { Env } from '../../config/env.validation';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Módulo de autenticación (Fase 2): login, logout, refresh y me con JWT
 * firmados (HS256) de vigencia corta (`ACCESS_TOKEN_TTL_MINUTES`, 15 min por
 * defecto); la renovación usa sesión revocable.
 */
@Module({
  imports: [
    // JwtModule inyectable: secret y TTL se leen de la configuración YA
    // validada por zod (un JWT_SECRET ausente o corto detiene el arranque).
    // `global: true` para que el guard global `AuthGuard` (AppModule) pueda
    // inyectar JwtService sin importar este módulo.
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: `${config.getOrThrow('ACCESS_TOKEN_TTL_MINUTES')}m` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
