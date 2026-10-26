import './helpers/dev-db-env'; // ANTES que test-env: carga el .env raíz (BD dev docker)
import './helpers/test-env';

import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

/**
 * Departamentos — Etapa 9 (retroalimentación): `GET /api/departamentos` y
 * `PATCH /api/departamentos/:id` contra la BD DEV REAL de docker.
 *
 * El catálogo es el SEED determinista de la migración 009 (8 áreas de LARCO),
 * así que el listado se verifica CON EXACTITUD (nombres y orden). El PATCH
 * solo cambia el COORDINADOR; el test lo restaura en `afterAll` para no dejar
 * la BD dev con un coordinador de mentira.
 *
 * ACCESO: el pool `pg` GLOBAL (`DatabaseService`); tokens con el `JwtService`
 * global (mismo `JWT_SECRET`). El admin sale del seed 002 (`admin@larco.co`).
 */

const ADMIN_EMAIL = 'admin@larco.co';

/** Las 8 áreas sembradas por la migración 009, EN ORDEN ALFABÉTICO (ASC). */
const DEPARTAMENTOS_SEED = [
  'ABASTECIMIENTO',
  'CONTABILIDAD',
  'GESTION HUMANA',
  'OFERTAS',
  'PREVENCION SST',
  'PROYECTOS',
  'SERVICIOS',
  'SISTEMAS',
] as const;

/** Nombre de coordinador de prueba (≥ 3 caracteres, como exige el DTO). */
const COORDINADOR_PRUEBA = 'Coordinador Prueba E2E';

describe('Departamentos — catálogo LARCO e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let database: DatabaseService;

  let tokenAdmin: string;
  let tokenAnalista: string;

  /** Estado original de SISTEMAS para restaurarlo en afterAll. */
  let coordinadorOriginalSistemas = '';

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || url.includes('127.0.0.1:5555')) {
      throw new Error(
        'Este test necesita la BD dev de docker: revisa docker-compose.dev.yml y el .env raíz (DATABASE_URL)',
      );
    }

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // Réplica EXACTA del ValidationPipe global de `src/main.ts`.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    jwt = app.get(JwtService);
    database = app.get(DatabaseService, { strict: false });

    const admins = await database.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      ADMIN_EMAIL,
    ]);
    const adminId = admins.rows[0]?.id;
    if (adminId === undefined) {
      throw new Error(
        `No se encontró el usuario ${ADMIN_EMAIL}: ejecuta las migraciones (pnpm --filter @ats/api db:migrate)`,
      );
    }

    tokenAdmin = await jwt.signAsync({ sub: adminId, email: ADMIN_EMAIL, role: 'admin_rrhh' });
    tokenAnalista = await jwt.signAsync({
      sub: adminId,
      email: 'e2e-deptos-analista@larco.test',
      role: 'analista_seleccion',
    });

    const original = await database.query<{ coordinador: string }>(
      'SELECT coordinador FROM departamentos WHERE nombre = $1',
      ['SISTEMAS'],
    );
    coordinadorOriginalSistemas = original.rows[0]?.coordinador ?? '';
  });

  afterAll(async () => {
    await app?.close();
    if (database !== undefined && coordinadorOriginalSistemas !== '') {
      // Restaura el coordinador original: la BD dev no queda tocada por el test.
      await database
        .query('UPDATE departamentos SET coordinador = $1 WHERE nombre = $2', [
          coordinadorOriginalSistemas,
          'SISTEMAS',
        ])
        .catch(() => undefined);
    }
  });

  it('sin token → 401', async () => {
    await request(app.getHttpServer()).get('/api/departamentos').expect(401);
  });

  it('con cualquier rol autenticado → 200 con las 8 áreas del seed', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/departamentos')
      .set('Authorization', `Bearer ${tokenAnalista}`)
      .expect(200);

    expect(response.body).toHaveLength(8);
    expect(response.body.map((dpto: { nombre: string }) => dpto.nombre)).toEqual([
      ...DEPARTAMENTOS_SEED,
    ]);

    for (const dpto of response.body) {
      expect(typeof dpto.id).toBe('string');
      expect(dpto.coordinador.length).toBeGreaterThan(0);
      expect(typeof dpto.totalCandidatos).toBe('number');
      expect(typeof dpto.totalRequerimientos).toBe('number');
      expect(typeof dpto.requerimientosAprobados).toBe('number');
    }
  });

  it('PATCH con admin_rrhh → 200 y el coordinador cambia (auditado)', async () => {
    const listado = await request(app.getHttpServer())
      .get('/api/departamentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    const sistemas = listado.body.find(
      (dpto: { nombre: string }) => dpto.nombre === 'SISTEMAS',
    ) as { id: string; coordinador: string };

    const response = await request(app.getHttpServer())
      .patch(`/api/departamentos/${sistemas.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ coordinador: COORDINADOR_PRUEBA })
      .expect(200);

    expect(response.body.coordinador).toBe(COORDINADOR_PRUEBA);

    // La escritura queda en audit_log con el actor (GUC `app.current_user_id`).
    const auditoria = await database.query<{ changed_by: string | null }>(
      `SELECT changed_by FROM audit_log
        WHERE table_name = 'departamentos' AND record_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [sistemas.id],
    );
    expect(auditoria.rows[0]?.changed_by).not.toBeNull();
  });

  it('PATCH con analista_seleccion → 403 (no es admin_rrhh)', async () => {
    const listado = await request(app.getHttpServer())
      .get('/api/departamentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    const sistemas = listado.body.find(
      (dpto: { nombre: string }) => dpto.nombre === 'SISTEMAS',
    ) as { id: string };

    await request(app.getHttpServer())
      .patch(`/api/departamentos/${sistemas.id}`)
      .set('Authorization', `Bearer ${tokenAnalista}`)
      .send({ coordinador: 'Nadie Deberia Cambiar' })
      .expect(403);
  });

  it('PATCH con id inexistente → 404; con cuerpo inválido → 400', async () => {
    await request(app.getHttpServer())
      .patch(`/api/departamentos/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ coordinador: COORDINADOR_PRUEBA })
      .expect(404);

    const listado = await request(app.getHttpServer())
      .get('/api/departamentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    const sistemas = listado.body.find(
      (dpto: { nombre: string }) => dpto.nombre === 'SISTEMAS',
    ) as { id: string };

    // Coordinador demasiado corto (MinLength 3) y campo extra prohibido.
    await request(app.getHttpServer())
      .patch(`/api/departamentos/${sistemas.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ coordinador: 'J' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/departamentos/${sistemas.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ coordinador: 'Nombre Válido', nombre: 'OTRO NOMBRE' })
      .expect(400);
  });
});
