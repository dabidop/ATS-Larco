import './helpers/test-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

/**
 * Doble de prueba del servicio de base de datos: no requiere PostgreSQL real.
 * `behavior: 'down'` simula un pool que no conecta (para el caso 503).
 */
function createFakeDatabase(behavior: 'up' | 'down'): DatabaseService {
  return {
    pool: {} as Pool,
    query: async () => {
      if (behavior === 'down') {
        throw new Error('doble de prueba: conexión rechazada');
      }
      return { rows: [{ ok: 1 }] };
    },
    onModuleDestroy: async () => {},
  } as unknown as DatabaseService;
}

describe('HealthController (e2e)', () => {
  let app: INestApplication | undefined;

  async function createApp(db: 'up' | 'down'): Promise<INestApplication> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(createFakeDatabase(db))
      .compile();

    const nestApp = moduleFixture.createNestApplication();
    nestApp.setGlobalPrefix('api');
    await nestApp.init();
    return nestApp;
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET /api/health → 200 con db up', async () => {
    app = await createApp('up');

    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      module: 'api',
      db: 'up',
    });
    expect(typeof response.body.timestamp).toBe('string');
    expect(typeof response.body.uptimeS).toBe('number');
  });

  it('GET /api/health → 503 con db down', async () => {
    app = await createApp('down');

    const response = await request(app.getHttpServer()).get('/api/health').expect(503);

    expect(response.body).toMatchObject({
      status: 'error',
      module: 'api',
      db: 'down',
    });
    expect(typeof response.body.timestamp).toBe('string');
  });
});
