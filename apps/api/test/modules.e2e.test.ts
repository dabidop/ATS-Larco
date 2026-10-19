import './helpers/test-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

/** Prefijos de los 10 módulos de negocio andamiajados en la Fase 1. */
const MODULE_PREFIXES = [
  'auth',
  'candidatos',
  'embudo',
  'antecedentes',
  'entrevistas',
  'proveedor',
  'historial',
  'uploads',
  'requerimientos',
  'importacion',
] as const;

function createFakeDatabase(): DatabaseService {
  return {
    pool: {} as Pool,
    query: async () => ({ rows: [{ ok: 1 }] }),
    onModuleDestroy: async () => {},
  } as unknown as DatabaseService;
}

describe('Módulos placeholder (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(createFakeDatabase())
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(MODULE_PREFIXES)('GET /api/%s/ping → placeholder', async (modulo) => {
    const response = await request(app.getHttpServer()).get(`/api/${modulo}/ping`).expect(200);

    expect(response.body).toEqual({ modulo, status: 'placeholder' });
  });
});
