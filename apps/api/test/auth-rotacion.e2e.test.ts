import './helpers/dev-db-env'; // ANTES que test-env: carga el .env raíz (BD dev docker)
import './helpers/production-test-env';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common/crypto/password.util';
import { DatabaseService } from '../src/database/database.service';

/**
 * Rotación del refresh token — e2e contra la BD dev REAL (PostgreSQL).
 *
 * ⚠ Igual que `codigo-generator.concurrency.test.ts`, este test necesita la BD
 * de docker: la garantía que se demuestra (bloqueo `FOR UPDATE` + update
 * condicional `WHERE used_at IS NULL`) es de PostgreSQL, y simularla con
 * dobles en memoria no demostraría nada.
 *
 * Qué cubre:
 *  1. El refresh funciona SIN access token (es lo que permite renovar cuando
 *     el access cookie ya expiró) y exige la prueba CSRF.
 *  2. Cada refresh token es de UN SOLO USO: reutilizarlo revoca la sesión
 *     entera (detección de reutilización / robo de token).
 *  3. Dos refresh concurrentes con el MISMO token: exactamente uno gana.
 *
 * AISLAMIENTO: crea su propio usuario `rotacion-refresh@larco.test` y lo borra
 * en `afterAll` (las sesiones y tokens caen en cascada), así que la BD dev
 * queda como estaba y el test puede repetirse.
 */

const EMAIL = 'rotacion-refresh@larco.test';
const PASSWORD = 'RotacionRefresh2026!';

type Cookies = Record<string, string>;

/** Extrae `nombre=valor` de la cabecera `Set-Cookie` de una respuesta. */
function cookiesDe(respuesta: request.Response): Cookies {
  const crudas = respuesta.headers['set-cookie'];
  const lista = Array.isArray(crudas) ? crudas : crudas === undefined ? [] : [crudas];
  const cookies: Cookies = {};
  for (const cookie of lista) {
    const [par] = cookie.split(';');
    const separador = par?.indexOf('=') ?? -1;
    if (par === undefined || separador < 0) continue;
    cookies[par.slice(0, separador)] = decodeURIComponent(par.slice(separador + 1));
  }
  return cookies;
}

/** Cabecera `Cookie` + `X-CSRF-Token` como los envía el navegador real. */
function peticionRefresh(app: INestApplication, cookies: Cookies, usarCsrf = true) {
  const peticion = request(app.getHttpServer())
    .post('/api/auth/refresh')
    .set('Cookie', `ats_refresh=${cookies.ats_refresh ?? ''}; ats_csrf=${cookies.ats_csrf ?? ''}`);
  return usarCsrf ? peticion.set('X-CSRF-Token', cookies.ats_csrf ?? '') : peticion;
}

describe('Refresh rotatorio — e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let userId = '';
  let loginSequence = 0;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || url.includes('127.0.0.1:5555')) {
      throw new Error(
        'Este test necesita la BD dev de docker: revisa docker-compose.dev.yml y el .env raíz (DATABASE_URL)',
      );
    }

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // Replica el ValidationPipe global de main.ts (los tests no ejecutan bootstrap).
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    app.getHttpAdapter().getInstance().set('trust proxy', true);

    db = app.get(DatabaseService);

    // Usuario propio de este test (borrado en afterAll): así la rotación se
    // demuestra contra filas REALES sin tocar las cuentas del repositorio.
    await db.query('DELETE FROM users WHERE email = $1', [EMAIL]);
    const hash = await hashPassword(PASSWORD);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (role_id, email, password_hash, full_name, active)
       SELECT r.id, $1, $2, 'Usuario Rotación', true
       FROM roles r WHERE r.code = 'admin_rrhh'
       RETURNING id`,
      [EMAIL, hash],
    );
    userId = rows[0]?.id ?? '';
    expect(userId).not.toBe('');
  });

  afterAll(async () => {
    // CASCADE: borra sesiones y refresh tokens del usuario de prueba.
    await db.query('DELETE FROM users WHERE email = $1', [EMAIL]);
    await app.close();
  });

  /** Login y devuelve las cookies HttpOnly que emite la API. */
  async function iniciarSesion(): Promise<Cookies> {
    loginSequence += 1;
    const respuesta = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Forwarded-For', `10.0.0.${loginSequence}`)
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    const cookies = cookiesDe(respuesta);
    cookies.ats_access ??= String(respuesta.body.accessToken ?? '');
    expect(cookies.ats_access).toBeTruthy();
    expect(cookies.ats_refresh).toBeTruthy();
    expect(cookies.ats_csrf).toBeTruthy();
    return cookies;
  }

  function peticionConAccess(cookies: Cookies, ruta: string) {
    return request(app.getHttpServer())
      .get(ruta)
      .set('Cookie', `ats_access=${cookies.ats_access ?? ''}`);
  }

  /** Fila de `auth_sessions` del refresh token con hash dado. */
  async function sesionDe(refresh: string | undefined) {
    const { rows } = await db.query<{ revoked_at: Date | null; user_id: string }>(
      `SELECT s.revoked_at, s.user_id
       FROM auth_session_refresh_tokens t
       JOIN auth_sessions s ON s.id = t.session_id
       WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [refresh ?? ''],
    );
    return rows[0];
  }

  it('renueva SIN access token y empareja refresh + CSRF', async () => {
    const cookies = await iniciarSesion();

    // Sin Authorization y sin access cookie: solo refresh + CSRF.
    const renovada = await peticionRefresh(app, cookies).expect(200);

    const nuevas = cookiesDe(renovada);
    expect(nuevas.ats_refresh).toBeTruthy();
    expect(nuevas.ats_refresh).not.toBe(cookies.ats_refresh);
    expect(nuevas.ats_access).toBeTruthy();

    const sesion = await sesionDe(cookies.ats_refresh);
    expect(sesion?.user_id).toBe(userId);
    expect(sesion?.revoked_at).toBeNull();
  });

  it('sin la prueba CSRF → 401 y la sesión NO se consume', async () => {
    const cookies = await iniciarSesion();

    await peticionRefresh(app, cookies, false).expect(401);

    const sesion = await sesionDe(cookies.ats_refresh);
    expect(sesion).toBeDefined();
    expect(sesion?.revoked_at).toBeNull();
  });

  it('reutilizar un refresh ya usado revoca la sesión entera', async () => {
    const cookies = await iniciarSesion();

    const renovada = await peticionRefresh(app, cookies).expect(200);
    const nuevas = cookiesDe(renovada);

    // Reutilizar el token ANTERIOR (el que un ladrón podría haber copiado).
    await peticionRefresh(app, cookies).expect(401);

    // La revocación es de SESIÓN: el token vigente también queda invalidado.
    const sesion = await sesionDe(nuevas.ats_refresh);
    expect(sesion?.revoked_at).not.toBeNull();
    await peticionRefresh(app, nuevas).expect(401);
  });

  it('dos refresh CONCURRENTES con el mismo token → exactamente uno gana', async () => {
    const cookies = await iniciarSesion();

    const [primera, segunda] = await Promise.all([
      peticionRefresh(app, cookies),
      peticionRefresh(app, cookies),
    ]);

    const estados = [primera.status, segunda.status].sort((a, b) => a - b);
    // El `FOR UPDATE OF t, s` serializa las dos transacciones: la segunda ve
    // `used_at` ya escrito → 401 y revoca la sesión (misma garantía que arriba).
    expect(estados).toEqual([200, 401]);

    // La revocación del perdedor se CONFIRMA (no se deshace con el 401).
    const sesion = await sesionDe(cookies.ats_refresh);
    expect(sesion?.revoked_at).not.toBeNull();
  });

  it('logout revoca la sesión y el access token deja de autorizar', async () => {
    const cookies = await iniciarSesion();

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set(
        'Cookie',
        `ats_access=${cookies.ats_access ?? ''}; ats_refresh=${cookies.ats_refresh ?? ''}; ats_csrf=${cookies.ats_csrf ?? ''}`,
      )
      .set('X-CSRF-Token', cookies.ats_csrf ?? '')
      .expect(204);

    await peticionConAccess(cookies, '/api/candidatos/ping').expect(401);
  });

  it('un cambio de rol en BD se aplica al siguiente request', async () => {
    const cookies = await iniciarSesion();

    await db.query(
      `UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'lider_area') WHERE id = $1`,
      [userId],
    );

    await request(app.getHttpServer())
      .post('/api/candidatos')
      .set('Cookie', `ats_access=${cookies.ats_access ?? ''}; ats_csrf=${cookies.ats_csrf ?? ''}`)
      .set('X-CSRF-Token', cookies.ats_csrf ?? '')
      .send({
        nombres: 'Candidato de prueba',
        apellidos: 'Cambio de rol',
        cedula: '987654321',
        departamentoId: '11111111-1111-4111-8111-111111111111',
      })
      .expect(403);

    await db.query(
      `UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'admin_rrhh') WHERE id = $1`,
      [userId],
    );
  });

  it('un usuario desactivado deja de autorizar el access token vigente', async () => {
    const cookies = await iniciarSesion();

    await db.query('UPDATE users SET active = false WHERE id = $1', [userId]);

    await peticionConAccess(cookies, '/api/candidatos/ping').expect(401);

    await db.query('UPDATE users SET active = true WHERE id = $1', [userId]);
  });
});
