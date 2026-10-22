import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { CryptoModule } from './common/crypto/crypto.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AppLoggerModule } from './logging/logger.module';
import { AntecedentesModule } from './modules/antecedentes/antecedentes.module';
import { AuthModule } from './modules/auth/auth.module';
import { CandidatosModule } from './modules/candidatos/candidatos.module';
import { EmbudoModule } from './modules/embudo/embudo.module';
import { EntrevistasModule } from './modules/entrevistas/entrevistas.module';
import { HistorialModule } from './modules/historial/historial.module';
import { ImportacionModule } from './modules/importacion/importacion.module';
import { ProveedorModule } from './modules/proveedor/proveedor.module';
import { RequerimientosModule } from './modules/requerimientos/requerimientos.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';

/**
 * Módulo raíz de la API (Fase 1).
 *
 * Orden de los imports: primero la infraestructura (configuración validada,
 * logging, base de datos), después los módulos de negocio.
 *
 * Guards globales (Fase 2, parte 2) — orden del array `providers` IMPORTA:
 * `AuthGuard` (autenticación) PRIMERO, `RolesGuard` (autorización/RBAC)
 * DESPUÉS, porque sin identidad no se puede autorizar, y `ThrottlerGuard`
 * (rate limiting, Fase 2, parte 4) al FINAL, para limitar peticiones por IP
 * una vez resueltas autenticación y autorización.
 *
 * Matriz RBAC inicial (ampliada con `superusuario` en la Etapa 8B):
 * | Ruta                                  | Acceso                                |
 * |---------------------------------------|---------------------------------------|
 * | GET /api/health                       | @Public()                             |
 * | POST /api/auth/login                  | @Public()                             |
 * | GET /api/auth/ping                    | @Public()                             |
 * | POST /api/auth/logout                 | autenticado (cualquier rol)           |
 * | POST /api/auth/refresh                | autenticado (cualquier rol)           |
 * | GET /api/auth/me                      | autenticado (cualquier rol)           |
 * | GET /api/auth|candidatos|embudo|antecedentes|entrevistas|proveedor|historial/ping | autenticado (sin @Roles) |
 * | GET /api/requerimientos/ping          | @Roles('admin_rrhh', 'superusuario', 'lider_area') |
 * | GET /api/importacion/ping             | @Roles('admin_rrhh', 'superusuario', 'analista_seleccion') |
 * | GET /api/uploads/ping                 | @Roles('admin_rrhh', 'analista_seleccion', 'superusuario') |
 * | GET|POST /api/usuarios, /:id          | @Roles('superusuario') (gestión de usuarios) |
 *
 * `superusuario` (IT, migración 008) hereda TODO el poder de `admin_rrhh`
 * sobre el negocio (crear/aprobar/cerrar requerimientos, crear candidatos,
 * mover el embudo) y es el ÚNICO rol que gestiona `/api/usuarios`.
 *
 * Toda ruta NO marcada con `@Public()` exige JWT válido; sin `@Roles(...)`
 * basta con estar autenticado.
 */

/** Ventana del rate limit global: 1 minuto (milisegundos, formato que exige throttler v6). */
const THROTTLE_TTL_MS = 60_000;

/** Peticiones máximas por IP y ventana en desarrollo/producción. */
const THROTTLE_LIMIT = 100;

@Module({
  imports: [
    // Infraestructura
    AppConfigModule,
    AppLoggerModule,
    DatabaseModule,
    // Cifrado de PII (Fase 2, parte 3): @Global, se registra una sola vez aquí.
    CryptoModule,
    // Rate limiting global (Fase 2, parte 4): 100 peticiones por minuto por IP.
    // `ttl` en MILISEGUNDOS: throttler v6 solo acepta números, no strings '1m'.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isTest = config.get('NODE_ENV') === 'test';
        return {
          // En test el rate limiting global se DESACTIVA por completo (`skipIf`),
          // no solo se sube el límite. Motivo: los decorados `@Throttle` (p. ej.
          // el del login, 5/min) prevalecen sobre la config del módulo, así que
          // un límite alto no bastaría —la propia suite de auth supera los 5
          // logins por ventana—. `skipIf` se evalúa ANTES de leer esos decorados
          // y omite el guard entero. Los tests de rate limit reales usan su
          // PROPIO ThrottlerModule con límite bajo (test/hardening.e2e.test.ts).
          skipIf: () => isTest,
          throttlers: [{ ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMIT }],
        };
      },
    }),
    // Salud
    HealthModule,
    // Módulos de negocio (andamiaje Fase 1)
    AuthModule,
    CandidatosModule,
    EmbudoModule,
    AntecedentesModule,
    EntrevistasModule,
    ProveedorModule,
    HistorialModule,
    UploadsModule,
    RequerimientosModule,
    ImportacionModule,
    // Gestión de cuentas: EXCLUSIVA del `superusuario` (IT, Etapa 8B).
    UsuariosModule,
  ],
  providers: [
    // Todas las respuestas de error usan el mismo formato JSON.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guards globales: PRIMERO autenticación, DESPUÉS autorización (el orden
    // del array determina el orden de ejecución de los APP_GUARD) y AL FINAL
    // el rate limiting (Fase 2, parte 4): limita por IP las peticiones que
    // superen el límite global (100/min) con un 429.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
