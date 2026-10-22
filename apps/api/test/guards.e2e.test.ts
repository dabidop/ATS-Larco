import './helpers/test-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common/crypto/password.util';
import { DatabaseService } from '../src/database/database.service';

/**
 * Tests e2e de los guards globales (Fase 2, parte 2): AuthGuard (JWT) y
 * RolesGuard (RBAC).
 *
 * Patrón de los tests existentes: `test-env` se importa ANTES que `AppModule`
 * (fija JWT_SECRET antes de que zod valide) y `DatabaseService` se sustituye
 * por un doble en memoria. Los guards NO tocan la BD: el doble solo hace
 * falta para el login (SELECT de credenciales) y para /api/auth/me.
 */

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'admin@larco.co';
const ADMIN_PASSWORD = 'DevAdmin2026!';
const ADMIN_ROLE = 'admin_rrhh';

/** Payload mínimo de un JWT (claims de negocio: sub + email + role). */
function payload(role: string, sub = ADMIN_ID): Record<string, unknown> {
  return { sub, email: ADMIN_EMAIL, role };
}

/**
 * Doble en memoria de `DatabaseService`: resuelve el SELECT por email (login)
 * y el SELECT por id (me) con un único admin activo.
 */
function createFakeDatabase(adminHash: string): DatabaseService {
  const admin = {
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    password_hash: adminHash,
    full_name: 'Administrador RRHH',
    active: true,
    role: ADMIN_ROLE,
  };

  return {
    pool: {} as Pool,
    query: async (text: string, params: unknown[]) => {
      if (text.includes('LOWER(u.email)')) {
        const email = String(params[0] ?? '').toLowerCase();
        return { rows: email === admin.email.toLowerCase() ? [admin] : [] };
      }
      if (text.includes('u.id = $1')) {
        const id = String(params[0] ?? '');
        return { rows: id === admin.id ? [admin] : [] };
      }
      return { rows: [] };
    },
    onModuleDestroy: async () => {},
  } as unknown as DatabaseService;
}

describe('Guards de autenticación y autorización (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    // Hash real del admin: login debe devolver 200 con credenciales correctas.
    const adminHash = await hashPassword(ADMIN_PASSWORD);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(createFakeDatabase(adminHash))
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    // JwtService global (JwtModule.registerAsync({ global: true }) en AuthModule).
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** GET con Authorization opcional. */
  function get(ruta: string, token?: string) {
    const peticion = request(app.getHttpServer()).get(ruta);
    return token === undefined ? peticion : peticion.set('Authorization', `Bearer ${token}`);
  }

  it('GET /api/health sin token → 200 (ruta pública)', async () => {
    const response = await get('/api/health').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', module: 'api' });
  });

  it('POST /api/auth/login sin token → 200 con credenciales válidas (sigue pública)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user.role).toBe(ADMIN_ROLE);
  });

  it('POST /api/auth/login sin token → 401 con credenciales inválidas (el guard no interviene)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'clave-mala' })
      .expect(401);

    expect(response.body.message).toBe('Credenciales inválidas');
  });

  it('GET /api/auth/ping sin token → 200 (ruta pública)', async () => {
    await get('/api/auth/ping').expect(200);
  });

  it('GET /api/candidatos/ping sin token → 401 con el formato JSON del filtro global', async () => {
    const response = await get('/api/candidatos/ping').expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      error: 'Unauthorized',
      path: '/api/candidatos/ping',
    });
    expect(typeof response.body.message).toBe('string');
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('GET /api/candidatos/ping con token de admin → 200', async () => {
    const response = await get('/api/candidatos/ping', jwt.sign(payload(ADMIN_ROLE))).expect(200);

    expect(response.body).toEqual({ modulo: 'candidatos', status: 'placeholder' });
  });

  it('GET /api/requerimientos/ping con token role=lider_area → 200', async () => {
    const response = await get('/api/requerimientos/ping', jwt.sign(payload('lider_area'))).expect(
      200,
    );

    expect(response.body).toEqual({ modulo: 'requerimientos', status: 'placeholder' });
  });

  it('GET /api/requerimientos/ping con token role=analista_seleccion → 403 en español', async () => {
    const response = await get(
      '/api/requerimientos/ping',
      jwt.sign(payload('analista_seleccion')),
    ).expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      message: 'No tienes permiso para realizar esta acción',
      error: 'Forbidden',
      path: '/api/requerimientos/ping',
    });
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('GET /api/requerimientos/ping con token role=superusuario → 200 (hereda admin_rrhh)', async () => {
    const response = await get(
      '/api/requerimientos/ping',
      jwt.sign(payload('superusuario')),
    ).expect(200);

    expect(response.body).toEqual({ modulo: 'requerimientos', status: 'placeholder' });
  });

  it('GET /api/importacion/ping con token role=analista_seleccion → 200', async () => {
    const response = await get(
      '/api/importacion/ping',
      jwt.sign(payload('analista_seleccion')),
    ).expect(200);

    expect(response.body).toEqual({ modulo: 'importacion', status: 'placeholder' });
  });

  it('GET /api/uploads/ping con token role=analista_seleccion → 200 (misma matriz que importacion)', async () => {
    const response = await get('/api/uploads/ping', jwt.sign(payload('analista_seleccion'))).expect(
      200,
    );

    expect(response.body).toEqual({ modulo: 'uploads', status: 'placeholder' });
  });

  it('token firmado con OTRA clave → 401', async () => {
    const ajeno = new JwtService({ secret: 'clave-ajena-0123456789-0123456789-0123' }).sign(
      payload(ADMIN_ROLE),
    );

    const response = await get('/api/candidatos/ping', ajeno).expect(401);
    expect(response.body.statusCode).toBe(401);
    expect(response.body.path).toBe('/api/candidatos/ping');
  });

  it('token manipulado (no es un JWT) → 401', async () => {
    await get('/api/candidatos/ping', 'token-basura-manipulado').expect(401);
    await get('/api/candidatos/ping', 'aaa.bbb.ccc').expect(401);
  });

  it('token expirado → 401', async () => {
    // Misma clave que la app, pero emitido ya vencido (expiración negativa).
    const vencido = new JwtService({ secret: process.env.JWT_SECRET }).sign(payload(ADMIN_ROLE), {
      expiresIn: '-1s',
    });

    const response = await get('/api/candidatos/ping', vencido).expect(401);
    expect(response.body.statusCode).toBe(401);
    expect(response.body.message).toEqual(expect.any(String));
  });

  it('GET /api/auth/me sin token → 401; con token válido → 200 (guard + servicio)', async () => {
    await get('/api/auth/me').expect(401);

    const response = await get('/api/auth/me', jwt.sign(payload(ADMIN_ROLE))).expect(200);
    expect(response.body).toEqual({
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      fullName: 'Administrador RRHH',
      role: ADMIN_ROLE,
    });
  });
});
