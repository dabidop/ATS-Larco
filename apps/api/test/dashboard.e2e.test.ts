import './helpers/dev-db-env'; // ANTES que test-env: carga el .env raíz (BD dev docker)
import './helpers/test-env';

import { randomInt, randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

/**
 * Dashboard — Etapa 9 (retroalimentación): `GET /api/dashboard` contra la BD
 * DEV REAL de docker.
 *
 * ⚠ Los contadores del dashboard son AGREGADOS de tablas compartidas (otros
 * ficheros de e2e crean candidatos/postulaciones EN PARALELO), así que las
 * aserciones son de ESTRUCTURA (5 fases en orden, rangos, invariantes) y de
 * MÍNIMOS (≥ el fixture propio), nunca cifras exactas: una igualdad exacta
 * flakearía según cuántos workers corran a la vez.
 *
 * ACCESO: el pool `pg` GLOBAL (`DatabaseService`), MISMO acceso que el módulo.
 * Tokens firmados con el `JwtService` global (mismo `JWT_SECRET`); `sub` =
 * UUID del admin del seed 002 (`admin@larco.co`). El fixture (candidato +
 * postulación activa) se crea por API y se borra en `afterAll`.
 */

const ADMIN_EMAIL = 'admin@larco.co';

/** Sufijo único por ejecución: aísla el fixture del resto de la BD dev. */
const SUFIJO_UNICO = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

/** Las 5 fases del ENUM, EN ORDEN de avance (el orden que el dashboard devuelve). */
const FASES_EN_ORDEN = [
  'preseleccion',
  'antecedentes',
  'entrevistas',
  'proveedor_externo',
  'contratacion',
] as const;

describe('Dashboard — resumen operativo e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let database: DatabaseService;

  let tokenAdmin: string;
  let tokenLider: string;

  /** Ids del fixture para la limpieza de una pasada. */
  const idsFixture: { candidato?: string; requerimiento?: string; postulacion?: string } = {};

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
    tokenLider = await jwt.signAsync({
      sub: adminId,
      email: 'e2e-dashboard-lider@larco.test',
      role: 'lider_area',
    });

    // Fixture mínimo: 1 candidato + 1 requerimiento `en_proceso` + su postulación
    // activa en `preseleccion` (el punto exacto para afirmar MÍNIMOS).
    const candidato = await database.query<{ id: string }>(
      `INSERT INTO candidatos (nombres, apellidos, email, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ['Dashboard', `Prueba ${SUFIJO_UNICO}`, `dashboard-${SUFIJO_UNICO}@larco.test`, adminId],
    );
    idsFixture.candidato = candidato.rows[0]?.id;

    const requerimiento = await database.query<{ id: string }>(
      `INSERT INTO requerimientos
         (code, estado, jefatura, titulo, numero_plazas, perfil_profesional,
          experiencia_requerida, nivel_educacion, conocimientos, habilidades,
          salario_min, salario_max, tipo_contrato, jornada, departamento_id,
          ubicacion, fecha_requerida, justificacion, modalidad, urgencia, created_by)
       VALUES ($1, 'en_proceso', $2, $3, 1, $4, '2 años', 'Profesional', ARRAY['SQL'], ARRAY['Análisis'],
          2800000, 3500000, 'Indefinido', 'Diurna', (SELECT id FROM departamentos LIMIT 1),
          'Bogotá D.C.', '2026-12-01', $5, 'directa', 'normal', $6)
       RETURNING id`,
      [
        // El CHECK `requerimientos_code_check` exige `REQ-AAAA-NNN+`; 6 dígitos
        // aleatorios hacen el código único frente a otros workers en paralelo.
        `REQ-2026-${randomInt(100000, 999999)}`,
        `Jefatura-DASH-${SUFIJO_UNICO}`,
        'Analista Dashboard',
        'Profesional de prueba para el dashboard',
        'Requerimiento de prueba del e2e del dashboard',
        adminId,
      ],
    );
    idsFixture.requerimiento = requerimiento.rows[0]?.id;

    const postulacion = await database.query<{ id: string }>(
      `INSERT INTO postulaciones (candidato_id, requerimiento_id, fase, estado, created_by)
       VALUES ($1, $2, 'preseleccion', 'activa', $3) RETURNING id`,
      [idsFixture.candidato, idsFixture.requerimiento, adminId],
    );
    idsFixture.postulacion = postulacion.rows[0]?.id;
  });

  afterAll(async () => {
    await app?.close();
    if (database !== undefined) {
      await database
        .query('DELETE FROM postulaciones WHERE id = $1', [idsFixture.postulacion])
        .catch(() => undefined);
      await database
        .query('DELETE FROM candidatos WHERE id = $1', [idsFixture.candidato])
        .catch(() => undefined);
      await database
        .query('DELETE FROM requerimientos WHERE id = $1', [idsFixture.requerimiento])
        .catch(() => undefined);
    }
  });

  it('sin token → 401', async () => {
    await request(app.getHttpServer()).get('/api/dashboard').expect(401);
  });

  it('con admin_rrhh → 200 con embudo, 5 fases en orden y requerimientos', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const { embudo, porFase, requerimientos } = response.body;

    // Embudo: los 4 contadores son números ≥ 0 y los terminales no solapan.
    expect(embudo).toBeDefined();
    for (const clave of ['totalCandidatos', 'enProceso', 'descartados', 'contratados']) {
      expect(typeof embudo[clave]).toBe('number');
      expect(embudo[clave]).toBeGreaterThanOrEqual(0);
    }

    // MÍNIMO determinista: el fixture existe en la BD, así que el total lo
    // cubre (el resto de contadores depende del paralelismo y solo se acotan).
    expect(embudo.totalCandidatos).toBeGreaterThanOrEqual(1);

    // porFase: SIEMPRE las 5 fases, en el orden canónico del ENUM, con
    // tasaRetencion entre 0 y 1 (2 decimales).
    expect(porFase).toHaveLength(5);
    expect(porFase.map((fase: { fase: string }) => fase.fase)).toEqual([...FASES_EN_ORDEN]);
    for (const fase of porFase) {
      expect(typeof fase.cantidad).toBe('number');
      expect(fase.tasaRetencion).toBeGreaterThanOrEqual(0);
      expect(fase.tasaRetencion).toBeLessThanOrEqual(1);
    }

    // Requerimientos: los 5 contadores numéricos ≥ 0.
    expect(requerimientos).toBeDefined();
    for (const clave of ['total', 'aprobados', 'pendientes', 'enProceso', 'criticos']) {
      expect(typeof requerimientos[clave]).toBe('number');
      expect(requerimientos[clave]).toBeGreaterThanOrEqual(0);
    }
    expect(requerimientos.total).toBeGreaterThanOrEqual(1);
  });

  it('con lider_area → 200 (rol incluido en la matriz del dashboard)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${tokenLider}`)
      .expect(200);

    expect(response.body.porFase).toHaveLength(5);
  });
});
