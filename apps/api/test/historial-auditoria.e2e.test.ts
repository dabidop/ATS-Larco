import './helpers/dev-db-env'; // ANTES que test-env: carga el .env raíz (BD dev docker)
import './helpers/test-env';

import { randomInt } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

/**
 * Bitácora de auditoría — Etapa 9 (retroalimentación, regla 7):
 * `GET /api/historial/auditoria`, contra la BD DEV REAL de docker.
 *
 * Cubre: el RBAC EXCLUSIVO del `superusuario` (ni admin_rrhh pasa), el diff
 * genérico campo a campo de `audit_log` (old_data/new_data), el ENMASCARAMIENTO
 * de la PII cifrada (`*_cifrada` → `[PROTEGIDO]`, nunca en claro), los filtros
 * (tabla/recordId/actor/desde/hasta) y la paginación.
 *
 * ACCESO: el pool `pg` GLOBAL (`DatabaseService`); tokens con el `JwtService`
 * global. El `superusuario` es el IT del seed 008 (`it@larco.co`); el admin del
 * seed 002 (`admin@larco.co`) sirve para demostrar el 403. El candidato de
 * prueba se crea VÍA API (así el trigger `audit_log` escribe el INSERT con el
 * actor correcto) y se borra en `afterAll`.
 */

const SUPER_EMAIL = 'it@larco.co';
const ADMIN_EMAIL = 'admin@larco.co';

/** Sufijo único por ejecución: aísla las filas de prueba del resto de la BD dev. */
const SUFIJO_UNICO = `${Date.now().toString(36)}-${randomInt(100000, 999999)}`;

/** Marca literal que el diff DEBE mostrar en claro (no es PII protegida). */
const NOMBRES_PRUEBA = `Bitacora ${SUFIJO_UNICO}`;

describe('Bitácora de auditoría — historial e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let database: DatabaseService;

  let tokenSuper: string;
  let tokenAdmin: string;
  let superId = '';

  /** Candidato creado por API como superusuario (su INSERT es la entrada a leer). */
  let candidatoId = '';

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

    const superusuario = await database.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [SUPER_EMAIL],
    );
    superId = superusuario.rows[0]?.id ?? '';
    if (superId === '') {
      throw new Error(
        `No se encontró el usuario ${SUPER_EMAIL}: ejecuta las migraciones (pnpm --filter @ats/api db:migrate)`,
      );
    }
    const admins = await database.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      ADMIN_EMAIL,
    ]);
    const adminId = admins.rows[0]?.id ?? '';
    if (adminId === '') {
      throw new Error(`No se encontró el usuario ${ADMIN_EMAIL}`);
    }

    tokenSuper = await jwt.signAsync({ sub: superId, email: SUPER_EMAIL, role: 'superusuario' });
    tokenAdmin = await jwt.signAsync({ sub: adminId, email: ADMIN_EMAIL, role: 'admin_rrhh' });

    // El candidato se crea VÍA API (no por SQL crudo): así el trigger
    // `candidatos_audit_log` escribe el INSERT con changed_by = superusuario,
    // que es exactamente lo que la bitácora debe mostrar. La cédula es
    // obligatoria en el DTO de creación (la opcionalidad de la migración 010
    // es para la IMPORTACIÓN, que va por SQL directo).
    const telefono = `300${randomInt(1000000, 9999999)}`;
    const cedula = `${randomInt(10000000, 99999999)}`;
    const response = await request(app.getHttpServer())
      .post('/api/candidatos')
      .set('Authorization', `Bearer ${tokenSuper}`)
      .send({
        nombres: NOMBRES_PRUEBA,
        apellidos: `Auditoria ${SUFIJO_UNICO}`,
        email: `bitacora-${SUFIJO_UNICO}@larco.test`,
        cedula,
        telefono,
      })
      .expect(201);
    candidatoId = response.body.id;
  });

  afterAll(async () => {
    await app?.close();
    if (database !== undefined && candidatoId !== '') {
      // audit_log es INMUTABLE y no se limpia: leerlo ES la prueba.
      await database
        .query('DELETE FROM candidatos WHERE id = $1', [candidatoId])
        .catch(() => undefined);
    }
  });

  it('sin token → 401; con admin_rrhh → 403 (solo superusuario)', async () => {
    await request(app.getHttpServer()).get('/api/historial/auditoria').expect(401);

    const respuesta = await request(app.getHttpServer())
      .get('/api/historial/auditoria')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(403);
    expect(respuesta.body.message).toBe('No tienes permiso para realizar esta acción');
  });

  it('con superusuario → 200 con el INSERT del candidato, actor y diff enmascarado', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/historial/auditoria?tabla=candidatos&recordId=${candidatoId}`)
      .set('Authorization', `Bearer ${tokenSuper}`)
      .expect(200);

    expect(Array.isArray(response.body.entradas)).toBe(true);
    expect(response.body.total).toBeGreaterThanOrEqual(1);

    const entrada = response.body.entradas.find(
      (registro: { accion: string }) => registro.accion === 'INSERT',
    );
    expect(entrada).toBeDefined();
    expect(entrada.tabla).toBe('candidatos');
    expect(entrada.registroId).toBe(candidatoId);

    // El actor se resuelve desde users (id crudo + email).
    expect(entrada.actor.id).toBe(superId);
    expect(entrada.actor.email).toBe(SUPER_EMAIL);

    // Diff: el nombre NO cifrado sale EN CLARO; la PII cifrada sale PROTEGIDA.
    const campos = new Map<string, { despues?: unknown }>(
      entrada.cambios.map((cambio: { campo: string; despues?: unknown }) => [cambio.campo, cambio]),
    );
    expect(campos.get('nombres')?.despues).toBe(NOMBRES_PRUEBA);
    const telefonoCifrado = campos.get('telefono_cifrada');
    expect(telefonoCifrado).toBeDefined();
    expect(String(telefonoCifrado?.despues)).toBe('[PROTEGIDO]');
    // La cédula SÍ se creó cifrada (AES-256-CBC): la bitácora la muestra como
    // `[PROTEGIDO]`, nunca en claro ni como valor cifrado crudo.
    const cedulaCifrada = campos.get('cedula_cifrada');
    expect(cedulaCifrada).toBeDefined();
    expect(String(cedulaCifrada?.despues)).toBe('[PROTEGIDO]');
  });

  it('filtra por actor y rango de fechas, y pagina con límite', async () => {
    // Por actor: solo entradas del superusuario.
    const porActor = await request(app.getHttpServer())
      .get(`/api/historial/auditoria?actor=${superId}&tabla=candidatos&recordId=${candidatoId}`)
      .set('Authorization', `Bearer ${tokenSuper}`)
      .expect(200);
    expect(porActor.body.total).toBeGreaterThanOrEqual(1);
    for (const entrada of porActor.body.entradas) {
      expect(entrada.actor.id).toBe(superId);
    }

    // Rango de fechas: `desde` en el pasado rec incluye; `hasta` imposible excluye.
    const desdePasado = await request(app.getHttpServer())
      .get(
        `/api/historial/auditoria?tabla=candidatos&recordId=${candidatoId}&desde=2020-01-01T00:00:00Z`,
      )
      .set('Authorization', `Bearer ${tokenSuper}`)
      .expect(200);
    expect(desdePasado.body.total).toBeGreaterThanOrEqual(1);

    const hastaImposible = await request(app.getHttpServer())
      .get(
        `/api/historial/auditoria?tabla=candidatos&recordId=${candidatoId}&hasta=2020-01-01T00:00:00Z`,
      )
      .set('Authorization', `Bearer ${tokenSuper}`)
      .expect(200);
    expect(hastaImposible.body.total).toBe(0);

    // Paginación: límite 1 ⇒ a lo sumo 1 entrada y ≥ 1 página.
    const paginada = await request(app.getHttpServer())
      .get(`/api/historial/auditoria?limite=1&tabla=candidatos&recordId=${candidatoId}`)
      .set('Authorization', `Bearer ${tokenSuper}`)
      .expect(200);
    expect(paginada.body.entradas.length).toBeLessThanOrEqual(1);
    expect(paginada.body.paginas).toBeGreaterThanOrEqual(paginada.body.total);
  });

  it('rechaza parámetros inválidos → 400', async () => {
    await request(app.getHttpServer())
      .get('/api/historial/auditoria?actor=no-es-uuid')
      .set('Authorization', `Bearer ${tokenSuper}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/historial/auditoria?limite=9999')
      .set('Authorization', `Bearer ${tokenSuper}`)
      .expect(400);
  });
});
