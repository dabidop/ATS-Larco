import './helpers/test-env';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common/crypto/password.util';
import { DatabaseService } from '../src/database/database.service';

/**
 * Tests e2e de autenticación (Fase 2, parte 1): login, logout, refresh y me.
 *
 * Siguen el patrón de los tests existentes: se importa `test-env` ANTES que
 * `AppModule` (fija process.env, incluido JWT_SECRET, antes de que zod valide)
 * y `DatabaseService` se sustituye por un doble en memoria.
 */

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'admin@larco.co';
const ADMIN_PASSWORD = 'DevAdmin2026!';
const ADMIN_FULL_NAME = 'Administrador RRHH';
const ADMIN_ROLE = 'admin_rrhh';

const INACTIVE_ID = '22222222-2222-4222-8222-222222222222';
const INACTIVE_EMAIL = 'inactivo@larco.co';

/** Mensaje único de fallo de login (anti user-enumeration). */
const INVALID_CREDENTIALS = 'Credenciales inválidas';

/** Vigencia esperada: JWT_TTL_HOURS=24 → 86400 segundos. */
const EXPECTED_EXPIRES_IN = 86400;

/** Fila mínima de `users` + `roles` que consume AuthService. */
interface FakeUser {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  active: boolean;
  role: string;
}

/**
 * Doble en memoria de `DatabaseService`: resuelve los dos SELECT de
 * `AuthService` (búsqueda por email y por id) sin tocar PostgreSQL.
 */
function createFakeDatabase(users: FakeUser[]): DatabaseService {
  return {
    pool: {} as Pool,
    query: async (text: string, params: unknown[]) => {
      if (text.includes('LOWER(u.email)')) {
        const email = String(params[0] ?? '').toLowerCase();
        const user = users.find((candidate) => candidate.email.toLowerCase() === email);
        return { rows: user !== undefined ? [user] : [] };
      }
      if (text.includes('u.id = $1')) {
        const id = String(params[0] ?? '');
        const user = users.find((candidate) => candidate.id === id);
        return { rows: user !== undefined ? [user] : [] };
      }
      return { rows: [] };
    },
    onModuleDestroy: async () => {},
  } as unknown as DatabaseService;
}

/** Payload esperado de los JWT emitidos por la API. */
interface DecodedJwt {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

/** Decodifica el payload de un JWT (base64url) sin verificar la firma. */
function decodeJwt(token: string): DecodedJwt {
  const payload = token.split('.')[1];
  if (payload === undefined) {
    throw new Error('El accessToken no tiene formato JWT');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DecodedJwt;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Hash real del admin con la utilidad de la Fase 1 (scrypt: se calcula una sola vez).
    const adminHash = await hashPassword(ADMIN_PASSWORD);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(
        createFakeDatabase([
          {
            id: ADMIN_ID,
            email: ADMIN_EMAIL,
            password_hash: adminHash,
            full_name: ADMIN_FULL_NAME,
            active: true,
            role: ADMIN_ROLE,
          },
          {
            id: INACTIVE_ID,
            email: INACTIVE_EMAIL,
            password_hash: adminHash,
            full_name: 'Usuario Inactivo',
            active: false,
            role: ADMIN_ROLE,
          },
        ]),
      )
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // Replica el ValidationPipe global de main.ts (los tests no ejecutan bootstrap).
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Login helper: devuelve la respuesta de POST /api/auth/login. */
  function postLogin(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/auth/login').send(body);
  }

  it('POST /api/auth/login → 200 con JWT de 24 h y el usuario admin', async () => {
    const response = await postLogin({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    }).expect(200);

    expect(response.body.tokenType).toBe('Bearer');
    expect(response.body.expiresIn).toBe(EXPECTED_EXPIRES_IN);
    expect(response.body.user).toEqual({
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      fullName: ADMIN_FULL_NAME,
      role: ADMIN_ROLE,
    });

    const decoded = decodeJwt(response.body.accessToken);
    expect(decoded.sub).toBe(ADMIN_ID);
    expect(decoded.email).toBe(ADMIN_EMAIL);
    expect(decoded.role).toBe(ADMIN_ROLE);
    expect(decoded.exp - decoded.iat).toBe(EXPECTED_EXPIRES_IN);
  });

  it('POST /api/auth/login → el email no distingue mayúsculas de minúsculas', async () => {
    const response = await postLogin({
      email: 'Admin@Larco.CO',
      password: ADMIN_PASSWORD,
    }).expect(200);

    expect(response.body.user.email).toBe(ADMIN_EMAIL);
  });

  it('POST /api/auth/login → 401 idéntico para contraseña incorrecta y email inexistente', async () => {
    const passwordMala = await postLogin({
      email: ADMIN_EMAIL,
      password: 'esta-no-es-la-clave',
    }).expect(401);
    const emailDesconocido = await postLogin({
      email: 'no.existe@larco.co',
      password: 'esta-no-es-la-clave',
    }).expect(401);

    // Mismo mensaje exacto: no se revela si el usuario existe.
    expect(passwordMala.body.message).toBe(INVALID_CREDENTIALS);
    expect(emailDesconocido.body.message).toBe(INVALID_CREDENTIALS);

    // Mismo cuerpo de respuesta (salvo el timestamp, propio de cada respuesta).
    const { timestamp: _timestampA, ...restoA } = passwordMala.body;
    const { timestamp: _timestampB, ...restoB } = emailDesconocido.body;
    expect(restoB).toEqual(restoA);
  });

  it.each([
    {
      description: 'email inválido y campo extra',
      body: { email: 'no-es-un-email', password: 'secreta', campoExtra: true },
    },
    {
      description: 'password ausente',
      body: { email: ADMIN_EMAIL },
    },
  ])('POST /api/auth/login → 400 con el formato del filtro si $description', async ({ body }) => {
    const response = await postLogin(body).expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      path: '/api/auth/login',
    });
    expect(response.body.message).toBeDefined();
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('POST /api/auth/login → 401 con el mismo mensaje si el usuario está inactivo', async () => {
    const response = await postLogin({
      email: INACTIVE_EMAIL,
      password: ADMIN_PASSWORD,
    }).expect(401);

    expect(response.body.message).toBe(INVALID_CREDENTIALS);
    expect(response.body.statusCode).toBe(401);
  });

  it('GET /api/auth/me → 401 sin Authorization; 200 con el usuario del token', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer token-basura')
      .expect(401);

    const login = await postLogin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).expect(200);
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    expect(response.body).toEqual({
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      fullName: ADMIN_FULL_NAME,
      role: ADMIN_ROLE,
    });
  });

  it('POST /api/auth/refresh → 200 con accessToken nuevo; 401 sin token o con token inválido', async () => {
    const login = await postLogin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).expect(200);

    const refreshed = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    expect(refreshed.body.accessToken).not.toBe(login.body.accessToken);
    expect(refreshed.body.tokenType).toBe('Bearer');
    expect(refreshed.body.expiresIn).toBe(EXPECTED_EXPIRES_IN);
    expect(refreshed.body.user).toEqual(login.body.user);

    // exp renovado: como mínimo igual (puede no haber avanzado un segundo).
    const expAnterior = decodeJwt(login.body.accessToken).exp;
    const expNuevo = decodeJwt(refreshed.body.accessToken).exp;
    expect(expNuevo).toBeGreaterThanOrEqual(expAnterior);

    await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer token-basura')
      .expect(401);
  });

  it('POST /api/auth/logout → 204', async () => {
    await request(app.getHttpServer()).post('/api/auth/logout').expect(204);
  });

  it('con un token válido de un usuario inactivo → 401 en me y refresh', async () => {
    // Token firmado con la clave real para un usuario que ya no está activo.
    const token = app.get(JwtService).sign({
      sub: INACTIVE_ID,
      email: INACTIVE_EMAIL,
      role: ADMIN_ROLE,
    });

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
