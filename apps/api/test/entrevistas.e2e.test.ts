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
 * Entrevistas — Etapa 9 (retroalimentación): agenda de entrevistas sobre una
 * postulación, contra la BD DEV REAL de docker.
 *
 * Cubre: creación (fecha, hora `HH:MM`, tipo, estado), los JOINs que resuelven
 * candidato y requerimiento en la respuesta, los filtros de la agenda
 * (desde/hasta/estado/postulacionId/candidatoId), el PATCH parcial y los
 * errores de negocio (404 sin postulación, 409 con postulación terminal).
 *
 * ACCESO: el pool `pg` GLOBAL (`DatabaseService`); tokens con el `JwtService`
 * global (mismo `JWT_SECRET`). El admin sale del seed 002 (`admin@larco.co`);
 * el candidato/requerimiento/postulación del fixture se INSERTAN directamente
 * en SQL (el embudo tiene SU propia suite; aquí lo que se prueba es la agenda).
 */

const ADMIN_EMAIL = 'admin@larco.co';

/** Sufijo único por ejecución: aísla las filas de prueba del resto de la BD dev. */
const SUFIJO_UNICO = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

/** Fecha canónica del fixture (formato `YYYY-MM-DD` que exige la BD). */
const FECHA_BASE = '2026-11-02';

describe('Entrevistas — agenda e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let database: DatabaseService;

  let tokenAdmin: string;
  let tokenLider: string;

  /** Fixture: candidato + requerimiento `en_proceso` + 2 postulaciones (2 candidatos). */
  let candidatoId: string;
  let candidatoDescartadoId: string;
  let requerimientoId: string;
  let postulacionActivaId: string;
  /** Postulación en estado terminal `descartado` (para el 409 de agenda). */
  let postulacionDescartadaId: string;

  /** Entrevista creada por POST (la usa el bloque de filtros y de PATCH). */
  let entrevistaCreadaId = '';

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
      email: 'e2e-entrevistas-lider@larco.test',
      role: 'lider_area',
    });

    const candidato = await database.query<{ id: string }>(
      `INSERT INTO candidatos (nombres, apellidos, email, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ['Entrevista', `Prueba ${SUFIJO_UNICO}`, `entrevista-${SUFIJO_UNICO}@larco.test`, adminId],
    );
    candidatoId = candidato.rows[0]?.id ?? '';

    const requerimiento = await database.query<{ id: string }>(
      `INSERT INTO requerimientos
         (code, estado, jefatura, titulo, numero_plazas, perfil_profesional,
          experiencia_requerida, nivel_educacion, conocimientos, habilidades,
          salario_min, salario_max, tipo_contrato, jornada, departamento_id,
          ubicacion, fecha_requerida, justificacion, modalidad, urgencia, created_by)
       VALUES ($1, 'en_proceso', $2, $3, 2, $4, '2 años', 'Profesional', ARRAY['SQL'], ARRAY['Análisis'],
          2800000, 3500000, 'Indefinido', 'Diurna', (SELECT id FROM departamentos LIMIT 1),
          'Bogotá D.C.', '2026-12-01', $5, 'directa', 'normal', $6)
       RETURNING id`,
      [
        `REQ-2026-${randomInt(100000, 999999)}`,
        `Jefatura-ENTV-${SUFIJO_UNICO}`,
        'Profesional Entrevistas',
        'Perfil de prueba del e2e de entrevistas',
        'Requerimiento de prueba del e2e de entrevistas',
        adminId,
      ],
    );
    requerimientoId = requerimiento.rows[0]?.id ?? '';

    const activa = await database.query<{ id: string }>(
      `INSERT INTO postulaciones (candidato_id, requerimiento_id, fase, estado, created_by)
       VALUES ($1, $2, 'entrevistas', 'activa', $3) RETURNING id`,
      [candidatoId, requerimientoId, adminId],
    );
    postulacionActivaId = activa.rows[0]?.id ?? '';

    // Segundo candidato con su postulación TERMINAL `descartado`: Etapa 9
    // exige UN candidato = UNA postulación (`UNIQUE(candidato_id)`), así que
    // el 409 de «agenda sobre terminal» necesita SU propio candidato.
    const candidatoDescartado = await database.query<{ id: string }>(
      `INSERT INTO candidatos (nombres, apellidos, email, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ['Descartado', `Prueba ${SUFIJO_UNICO}`, `descartado-${SUFIJO_UNICO}@larco.test`, adminId],
    );
    candidatoDescartadoId = candidatoDescartado.rows[0]?.id ?? '';

    const otroRequerimiento = await database.query<{ id: string }>(
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
        `REQ-2026-${randomInt(100000, 999999)}`,
        `Jefatura-ENTV2-${SUFIJO_UNICO}`,
        'Profesional Entrevistas 2',
        'Perfil de prueba 2 del e2e de entrevistas',
        'Requerimiento de prueba 2 del e2e de entrevistas',
        adminId,
      ],
    );
    const descartada = await database.query<{ id: string }>(
      `INSERT INTO postulaciones
         (candidato_id, requerimiento_id, fase, estado, motivo_descarte, created_by)
       VALUES ($1, $2, 'preseleccion', 'descartado', $3, $4) RETURNING id`,
      [candidatoDescartadoId, otroRequerimiento.rows[0]?.id, `Motivo ${SUFIJO_UNICO}`, adminId],
    );
    postulacionDescartadaId = descartada.rows[0]?.id ?? '';
  });

  afterAll(async () => {
    await app?.close();
    if (database !== undefined) {
      await database
        .query('DELETE FROM postulaciones WHERE candidato_id = ANY($1::uuid[])', [
          [candidatoId, candidatoDescartadoId],
        ])
        .catch(() => undefined);
      await database
        .query(
          `DELETE FROM requerimientos
            WHERE jefatura LIKE $1 OR jefatura LIKE $2`,
          [`Jefatura-ENTV-${SUFIJO_UNICO}%`, `Jefatura-ENTV2-${SUFIJO_UNICO}%`],
        )
        .catch(() => undefined);
      await database
        .query('DELETE FROM candidatos WHERE id = ANY($1::uuid[])', [
          [candidatoId, candidatoDescartadoId],
        ])
        .catch(() => undefined);
    }
  });

  it('sin token → 401; con lider_area → 403 (rol no incluido)', async () => {
    await request(app.getHttpServer()).get('/api/entrevistas').expect(401);
    await request(app.getHttpServer())
      .get('/api/entrevistas')
      .set('Authorization', `Bearer ${tokenLider}`)
      .expect(403);
  });

  it('POST crea la entrevista con hora HH:MM, estado agendada y los JOINs resueltos', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/entrevistas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        postulacionId: postulacionActivaId,
        fecha: FECHA_BASE,
        hora: '09:30',
        tipo: 'Entrevista inicial',
        entrevistador: 'Laura Gómez',
      })
      .expect(201);

    entrevistaCreadaId = response.body.id;
    expect(response.body).toMatchObject({
      postulacionId: postulacionActivaId,
      fecha: FECHA_BASE,
      hora: '09:30',
      tipo: 'Entrevista inicial',
      entrevistador: 'Laura Gómez',
      estado: 'agendada',
    });
    // Los JOINs resuelven candidato y requerimiento (agenda de una sola lectura).
    expect(response.body.candidato.id).toBe(candidatoId);
    expect(response.body.candidato.nombre).toBe(`Entrevista Prueba ${SUFIJO_UNICO}`);
    expect(response.body.requerimiento.id).toBe(requerimientoId);
    expect(response.body.requerimiento.codigo).toMatch(/^REQ-2026-\d+$/);
  });

  it('POST con postulación inexistente → 404; con terminal → 409; hora inválida → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/entrevistas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ postulacionId: randomUUID(), fecha: FECHA_BASE, tipo: 'Psicotécnica' })
      .expect(404);

    const terminal = await request(app.getHttpServer())
      .post('/api/entrevistas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ postulacionId: postulacionDescartadaId, fecha: FECHA_BASE, tipo: 'Psicotécnica' })
      .expect(409);
    expect(String(terminal.body.message)).toContain('terminal');

    await request(app.getHttpServer())
      .post('/api/entrevistas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ postulacionId: postulacionActivaId, fecha: FECHA_BASE, hora: '25:99', tipo: 'X' })
      .expect(400);
  });

  it('GET filtra por postulación, candidato, estado y rango de fechas', async () => {
    // Por postulación (la recién creada).
    const porPostulacion = await request(app.getHttpServer())
      .get(`/api/entrevistas?postulacionId=${postulacionActivaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(porPostulacion.body).toHaveLength(1);
    expect(porPostulacion.body[0].id).toBe(entrevistaCreadaId);

    // Por candidato (ambas postulaciones comparten candidato; solo hay 1 entrevista).
    const porCandidato = await request(app.getHttpServer())
      .get(`/api/entrevistas?candidatoId=${candidatoId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(porCandidato.body).toHaveLength(1);

    // Rango de fechas INCLUSIVO: desde=hasta=la fecha exacta la incluye.
    const rango = await request(app.getHttpServer())
      .get(`/api/entrevistas?desde=${FECHA_BASE}&hasta=${FECHA_BASE}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(
      rango.body.some((entrevista: { id: string }) => entrevista.id === entrevistaCreadaId),
    ).toBe(true);

    // Estado agendada la contiene; realizada no (aún no se cambió).
    const agendadas = await request(app.getHttpServer())
      .get(`/api/entrevistas?estado=agendada&postulacionId=${postulacionActivaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(agendadas.body).toHaveLength(1);
    const realizadas = await request(app.getHttpServer())
      .get(`/api/entrevistas?estado=realizada&postulacionId=${postulacionActivaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(realizadas.body).toHaveLength(0);
  });

  it('PATCH cambia estado y notas, y deja la hora en HH:MM', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/entrevistas/${entrevistaCreadaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ estado: 'realizada', notas: `Evaluación completa ${SUFIJO_UNICO}` })
      .expect(200);

    expect(response.body).toMatchObject({
      id: entrevistaCreadaId,
      estado: 'realizada',
      notas: `Evaluación completa ${SUFIJO_UNICO}`,
      // Campos NO tocados por el PATCH siguen intactos (update parcial).
      fecha: FECHA_BASE,
      hora: '09:30',
      tipo: 'Entrevista inicial',
    });
  });

  it('PATCH con id inexistente → 404', async () => {
    await request(app.getHttpServer())
      .patch(`/api/entrevistas/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ estado: 'cancelada' })
      .expect(404);
  });
});
