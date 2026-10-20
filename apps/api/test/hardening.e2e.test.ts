import './helpers/test-env';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import helmet from 'helmet';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AuthGuard } from '../src/common/guards/auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { HealthModule } from '../src/health/health.module';
import { AppLoggerModule } from '../src/logging/logger.module';
import { AuthModule } from '../src/modules/auth/auth.module';

/**
 * Tests e2e de endurecimiento (Fase 2, parte 4): helmet, rate limiting y 429.
 *
 * Patrón de los tests existentes (`test-env` antes que los módulos, doble de
 * `DatabaseService`), pero con una diferencia IMPORTANTE respecto a los demás:
 * aquí NO se importa `AppModule`, sino un conjunto de módulos mínimo que
 * registra su PROPIO `ThrottlerModule` con límite BAJO. Así el 429 se provoca
 * de verdad sin depender del throttler global (que en test usa un límite muy
 * alto a propósito para no interferir con el resto de la suite).
 *
 * Se replica el orden de guards de `AppModule`: AuthGuard → RolesGuard →
 * ThrottlerGuard (el último es el que limita).
 */

/** Ventana corta (1 s) para poder demostrar el reseteo del límite con rapidez. */
const THROTTLE_TTL_MS_TEST = 1_000;

/** Límite bajo del throttler de PRUEBA (peticiones por ventana y por IP). */
const THROTTLE_LIMIT_TEST = 3;

/** Credenciales inválidas: el login responde 401 (la BD doble no devuelve usuarios). */
const LOGIN_BODY = { email: 'no.existe@larco.co', password: 'clave-mala' };

/**
 * Doble en memoria de `DatabaseService`: no devuelve NINGÚN usuario (login →
 * 401 vía hash decoy) y resuelve cualquier otra consulta — p. ej. `SELECT 1`
 * del health check — sin tocar PostgreSQL.
 */
function createFakeDatabase(): DatabaseService {
  return {
    pool: {} as Pool,
    query: async () => ({ rows: [] }),
    onModuleDestroy: async () => {},
  } as unknown as DatabaseService;
}

describe('Endurecimiento: helmet y rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        // Infraestructura mínima: configuración validada y logging (el Logger
        // de nestjs-pino es global y lo inyectan AuthController y el filtro).
        AppConfigModule,
        AppLoggerModule,
        DatabaseModule,
        // Rutas bajo prueba: health (helmet) y auth (login + ping).
        HealthModule,
        AuthModule,
        // Throttler PROPIO con límite bajo para provocar 429 de verdad. Es
        // global (@Global), así que su ThrottlerGuard/ storage quedan
        // disponibles; NO se usa el throttler global de AppModule.
        ThrottlerModule.forRoot([{ ttl: THROTTLE_TTL_MS_TEST, limit: THROTTLE_LIMIT_TEST }]),
      ],
      providers: [
        // Mismo formato de error que el resto de la app (el 429 sale en su JSON).
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Mismo orden de guards que AppModule: auth → roles → throttler.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    })
      .overrideProvider(DatabaseService)
      .useValue(createFakeDatabase())
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // Igual que en main.ts: helmet con sus defaults (API JSON).
    app.use(helmet());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Espera `ms` milisegundos (para demostrar el reseteo de la ventana). */
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('helmet: un GET a una ruta pública (@Public) lleva cabeceras de seguridad y sin x-powered-by', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    // Cabeceras que helmet@8 pone por defecto (verificadas en su código):
    // X-Frame-Options, X-Content-Type-Options (nosniff SIGUE activo en v8),
    // Referrer-Policy, COOP, CORP, HSTS y CSP.
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['content-security-policy']).toBeDefined();

    // helmet@8 elimina X-Powered-By (Express lo habría añadido por defecto).
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('login: el @Throttle (5/min) devuelve 429 en el 6º intento con Retry-After', async () => {
    const httpServer = app.getHttpServer();

    // Los 5 primeros intentos fallan con 401 (credenciales inválidas), pero
    // SUMAN al contador: el rate limit protege contra fuerza bruta aunque las
    // credenciales sean malas. El decorador @Throttle (limit 5, ttl 60 s) del
    // login prevalece sobre el límite del módulo (3), por eso el 429 llega en
    // el 6º intento y no en el 4º.
    // Secuencial a propósito: los intentos deben agotar la ventana del throttler.
    for (let intento = 1; intento <= 5; intento += 1) {
      const response = await request(httpServer).post('/api/auth/login').send(LOGIN_BODY);
      expect(response.status).toBe(401);
    }

    const bloqueada = await request(httpServer)
      .post('/api/auth/login')
      .send(LOGIN_BODY)
      .expect(429);

    // Retry-After: el throttler indica cuándo reintentar (segundos).
    expect(bloqueada.headers['retry-after']).toBeDefined();
    // Cuerpo con el formato unificado del filtro global.
    expect(bloqueada.body.statusCode).toBe(429);
    expect(typeof bloqueada.body.message).toBe('string');
  });

  it('límite global del throttler: 3 peticiones por ventana y la 4ª → 429 con Retry-After', async () => {
    const httpServer = app.getHttpServer();
    const rutaPublica = '/api/auth/ping'; // @Public, sin @Throttle → aplica el límite del módulo (3/1 s).

    // Las 3 primeras caben en la ventana (secuenciales a propósito, para
    // agotar la ventana del throttler).
    for (let intento = 1; intento <= 3; intento += 1) {
      await request(httpServer).get(rutaPublica).expect(200);
    }

    // La 4ª supera el límite → 429.
    const bloqueada = await request(httpServer).get(rutaPublica).expect(429);
    expect(bloqueada.headers['retry-after']).toBeDefined();
    expect(bloqueada.body.statusCode).toBe(429);
  });

  it('el límite se resetea tras la ventana (ttl): la petición vuelve a 200', async () => {
    const httpServer = app.getHttpServer();
    const rutaPublica = '/api/auth/ping';

    // Deja expirar la ventana (ttl 1 s) y el bloqueo (blockDuration = ttl).
    await sleep(1_200);

    const response = await request(httpServer).get(rutaPublica).expect(200);
    expect(response.status).toBe(200);
  });
});
