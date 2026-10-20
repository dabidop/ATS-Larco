import './helpers/test-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { validateEnv } from '../src/config/env.validation';
import { DatabaseService } from '../src/database/database.service';

/**
 * Tests e2e de la Fase 2, parte 3 (cifrado de PII):
 *
 * 1. `CryptoModule` (@Global) queda registrado en `AppModule` y el
 *    `CryptoService` es resoluble desde la raíz sin importarlo en el módulo
 *    consumidor (igual que `DatabaseService`).
 * 2. La validación zod de `CRYPTO_KEY_BASE64` (obligatoria, 32 bytes) y
 *    `CRYPTO_KEY_PREVIOUS_BASE64` (opcional) con mensajes claros en español.
 */

/** Doble de `DatabaseService`: los tests no tocan PostgreSQL real. */
function createFakeDatabase(): DatabaseService {
  return {
    pool: {} as Pool,
    query: async () => ({ rows: [{ ok: 1 }] }),
    onModuleDestroy: async () => {},
  } as unknown as DatabaseService;
}

/** Configuración mínima válida (solo campos obligatorios del esquema). */
function baseEnv(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgres://test:test@127.0.0.1:5555/ats_test',
    JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123456789abcdef',
    ...extra,
  };
}

describe('CryptoService registrado en AppModule (e2e)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('resuelve CryptoService desde la raíz (módulo @Global) y hace roundtrip', async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(createFakeDatabase())
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Sin importar CryptoModule en ningún módulo consumidor: es @Global.
    const crypto = app.get(CryptoService);
    expect(crypto.decrypt(crypto.encrypt('María Pérez 1234567890'))).toBe('María Pérez 1234567890');
    expect(crypto.decrypt('')).toBeNull();
  });
});

describe('Validación zod de las llaves CRYPTO_* (e2e)', () => {
  const KEY_32 = Buffer.alloc(32, 7).toString('base64');

  it('acepta CRYPTO_KEY_BASE64 de exactamente 32 bytes', () => {
    const env = validateEnv(baseEnv({ CRYPTO_KEY_BASE64: KEY_32 }));
    expect(env.CRYPTO_KEY_BASE64).toBe(KEY_32);
  });

  it.each([undefined, ''])('CRYPTO_KEY_BASE64 ausente/vacía (%s) → error claro', (valor) => {
    expect(() => validateEnv(baseEnv({ CRYPTO_KEY_BASE64: valor }))).toThrow(
      'CRYPTO_KEY_BASE64 es requerida (32 bytes en base64)',
    );
  });

  it('CRYPTO_KEY_BASE64 con longitud distinta de 32 bytes → error claro', () => {
    expect(() => validateEnv(baseEnv({ CRYPTO_KEY_BASE64: 'demasiado-corta' }))).toThrow(
      'CRYPTO_KEY_BASE64 debe decodificar a exactamente 32 bytes en base64',
    );
  });

  it.each([undefined, ''])(
    'CRYPTO_KEY_PREVIOUS_BASE64 opcional: ausente/vacía (%s) es válida',
    (valor) => {
      const env = validateEnv(
        baseEnv({ CRYPTO_KEY_BASE64: KEY_32, CRYPTO_KEY_PREVIOUS_BASE64: valor }),
      );
      expect(env.CRYPTO_KEY_PREVIOUS_BASE64).toBeUndefined();
    },
  );

  it('CRYPTO_KEY_PREVIOUS_BASE64 presente pero no 32 bytes → error claro', () => {
    expect(() =>
      validateEnv(baseEnv({ CRYPTO_KEY_BASE64: KEY_32, CRYPTO_KEY_PREVIOUS_BASE64: 'otra-corta' })),
    ).toThrow('CRYPTO_KEY_PREVIOUS_BASE64 debe decodificar a exactamente 32 bytes en base64');
  });
});
