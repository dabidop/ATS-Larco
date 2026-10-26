import './helpers/test-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

/**
 * Prefijos de los módulos que AÚN exponen el `ping` de andamiaje de la Fase 1.
 * `entrevistas`, `historial` e `importacion` dejaron de tenerlo en la Etapa 9:
 * ya son módulos reales y sus rutas las cubren sus propias suites e2e.
 */
const MODULE_PREFIXES = [
  'auth',
  'candidatos',
  'embudo',
  'antecedentes',
  'proveedor',
  'uploads',
  'requerimientos',
] as const;

/**
 * `auth/ping` es `@Public()`; el resto de pings exigen JWT (algunos además
 * roles, según la matriz RBAC de `AppModule`). Un token de `admin_rrhh`
 * cumple todos los `@Roles(...)` de la matriz.
 */
const PREFIJOS_PROTEGIDOS = MODULE_PREFIXES.filter((modulo) => modulo !== 'auth');

function createFakeDatabase(): DatabaseService {
  return {
    pool: {} as Pool,
    query: async () => ({ rows: [{ ok: 1 }] }),
    onModuleDestroy: async () => {},
  } as unknown as DatabaseService;
}

describe('Módulos placeholder (e2e)', () => {
  let app: INestApplication;
  let tokenAdmin: string;

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

    // Token de admin emitido con el JwtService global de la app (mismo secret).
    tokenAdmin = app.get(JwtService).sign({
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'admin@larco.co',
      role: 'admin_rrhh',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(MODULE_PREFIXES)('GET /api/%s/ping con token → placeholder', async (modulo) => {
    const response = await request(app.getHttpServer())
      .get(`/api/${modulo}/ping`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(response.body).toEqual({ modulo, status: 'placeholder' });
  });

  it.each(PREFIJOS_PROTEGIDOS)('GET /api/%s/ping sin token → 401', async (modulo) => {
    await request(app.getHttpServer()).get(`/api/${modulo}/ping`).expect(401);
  });

  it('GET /api/auth/ping sin token → 200 (ruta pública)', async () => {
    const response = await request(app.getHttpServer()).get('/api/auth/ping').expect(200);

    expect(response.body).toEqual({ modulo: 'auth', status: 'placeholder' });
  });
});
