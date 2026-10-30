import './helpers/dev-db-env'; // ANTES que test-env: carga el .env raíz (BD dev docker)
import './helpers/test-env';

import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { RequerimientosStoreService } from '../src/modules/requerimientos/requerimientos-store.service';

/**
 * Requerimientos — Fase 3, parte 4: máquina de estados con permisos por rol,
 * contra la BD DEV REAL de docker.
 *
 * ⚠ ESTE test usa la base de datos de desarrollo (`DATABASE_URL` del `.env`
 * raíz → localhost:5432/ats_dev), como `requerimientos-crud.e2e.test.ts`.
 * Motivo: lo que hay que probar ES de PostgreSQL y de la capa real — el
 * CHECK `requerimientos_rechazo_check`, el trigger `audit_fila()` con el GUC
 * del actor (migración 004) y la escritura `UPDATE ... WHERE estado = origen`
 * dentro de transacción. Falsear el repositorio demostraría nada.
 *
 * Aislaramiento y repetibilidad (mismo patrón que el CRUD):
 *  - Tokens JWT firmados con el `JwtService` global (mismo `JWT_SECRET`).
 *  - `sub` = UUIDs de usuarios REALES (FK `created_by` → `users(id)`): el
 *    admin sale del seed 002 (`admin@larco.co`); líder creador, otro líder y
 *    analista se CREAN en `beforeAll` y se BORRAN en `afterAll`.
 *  - Todos los requerimientos llevan la MISMA `jefatura` con sufijo único por
 *    ejecución: la limpieza los borra de una vez y no colisionan con otros
 *    ficheros.
 *  - `afterAll` borra requerimientos + usuarios en UNA transacción (deshabilita
 *    `audit_log_no_mutation` SOLO ahí, patrón de 002/crud, para poder borrar
 *    usuarios referenciados por `audit_log.changed_by`). `audit_log` NO se
 *    limpia: es INMUTABLE y comprobar su contenido ES parte del test.
 *  - Orden de los `it` = orden de escritura: los bloques de auditoría usan los
 *    ids que dejaron los bloques anteriores.
 */

const ADMIN_EMAIL = 'admin@larco.co';

/** Hash de mentira: estos usuarios jamás inician sesión (solo aportan un id). */
const PASSWORD_HASH_FICTICIO = 'no-utilizable-en-tests';

/** Usuarios de prueba (creados y borrados por ESTE test). */
const USUARIOS_DE_PRUEBA = [
  { email: 'req-flujo-creador@larco.test', fullName: 'Test Flujo Creador', role: 'lider_area' },
  {
    email: 'req-flujo-otro-lider@larco.test',
    fullName: 'Test Flujo Otro Lider',
    role: 'lider_area',
  },
  {
    email: 'req-flujo-analista@larco.test',
    fullName: 'Test Flujo Analista',
    role: 'analista_seleccion',
  },
] as const;

const EMAIL_CREADOR = USUARIOS_DE_PRUEBA[0].email;
const EMAIL_OTRO_LIDER = USUARIOS_DE_PRUEBA[1].email;
const EMAIL_ANALISTA = USUARIOS_DE_PRUEBA[2].email;

/** Sufijo único por ejecución: aísla las filas de prueba del resto de la BD dev. */
const SUFIJO_UNICO = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

/** `jefatura` de TODOS los requerimientos de este test (limpieza de una vez). */
const JEFATURA_FLUJO = `Jefatura-FLUJO-${SUFIJO_UNICO}`;

/** Motivo canónico de rechazo usado en las pruebas que sí deben escribirlo. */
const MOTIVO_RECHAZO = 'Rechazado por cobertura del presupuesto del área';

describe('Requerimientos — máquina de estados e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let appInicializado = false;
  let jwt: JwtService;
  let dataSource: DataSource;

  let adminId: string;
  let creadorId: string;
  let analistaId: string;

  let tokenAdmin: string;
  let tokenCreador: string;
  let tokenOtroLider: string;
  let tokenAnalista: string;

  /** Requerimiento cerrado por la cadena feliz: su `record_id` alimenta la auditoría. */
  let requerimientoCerradoId = '';

  /** Rechazado por admin con motivo: para comprobar el 409 desde un terminal. */
  let requerimientoRechazadoId = '';
  let departamentoId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || url.includes('127.0.0.1:5555')) {
      // test-env fija esa URL falsa como último recurso: aquí haría falta la
      // BD dev real. Falla temprano y con mensaje claro si docker no corre.
      throw new Error(
        'Este test necesita la BD dev de docker: revisa docker-compose.dev.yml y el .env raíz (DATABASE_URL)',
      );
    }

    // AppModule REAL, sin overrides: el DataSource del módulo de requerimientos
    // se inicializa de forma perezosa al primer uso (patrón de la parte 1).
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // Réplica EXACTA del ValidationPipe global de `src/main.ts`.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    appInicializado = true;

    jwt = app.get(JwtService);
    const store = app.get(RequerimientosStoreService, { strict: false });
    dataSource = app.get(DataSource, { strict: false });

    // Abre la conexión LAZY del módulo (mismo patrón que el test de CRUD).
    await store.repo();
    const departamentos = (await dataSource.query(
      'SELECT id FROM departamentos ORDER BY nombre LIMIT 1',
    )) as Array<{ id: string }>;
    departamentoId = departamentos[0]?.id ?? '';
    if (departamentoId === '') throw new Error('No se encontró un departamento para el fixture');

    // El admin del seed 002 es el único admin_rrhh real de la BD dev.
    const admins = (await dataSource.query('SELECT id FROM users WHERE email = $1', [
      ADMIN_EMAIL,
    ])) as Array<{ id: string }>;
    adminId = admins[0]?.id ?? '';
    if (adminId === '') {
      throw new Error(
        `No se encontró el usuario ${ADMIN_EMAIL}: ejecuta las migraciones (pnpm --filter @ats/api db:migrate)`,
      );
    }

    // Usuarios de prueba (FK `created_by` → `users(id)`: hacen falta UUIDs reales).
    for (const usuario of USUARIOS_DE_PRUEBA) {
      await dataSource.query(
        `INSERT INTO users (role_id, email, password_hash, full_name, active)
         SELECT r.id, $1, $2, $3, true FROM roles r WHERE r.code = $4
         ON CONFLICT (email) DO NOTHING`,
        [usuario.email, PASSWORD_HASH_FICTICIO, usuario.fullName, usuario.role],
      );
    }

    const usuarios = (await dataSource.query(
      'SELECT id, email FROM users WHERE email = ANY($1::text[])',
      [USUARIOS_DE_PRUEBA.map((usuario) => usuario.email)],
    )) as Array<{ id: string; email: string }>;

    const idDe = (email: string): string => {
      const id = usuarios.find((usuario) => usuario.email === email)?.id;
      if (id === undefined) {
        throw new Error(`El usuario de prueba ${email} no pudo crearse en la BD dev`);
      }
      return id;
    };
    creadorId = idDe(EMAIL_CREADOR);
    analistaId = idDe(EMAIL_ANALISTA);

    // Tokens firmados con el MISMO secreto que la app (JwtService global).
    tokenAdmin = jwt.sign({ sub: adminId, email: ADMIN_EMAIL, role: 'admin_rrhh' });
    tokenCreador = jwt.sign({ sub: creadorId, email: EMAIL_CREADOR, role: 'lider_area' });
    tokenOtroLider = jwt.sign({
      sub: idDe(EMAIL_OTRO_LIDER),
      email: EMAIL_OTRO_LIDER,
      role: 'lider_area',
    });
    tokenAnalista = jwt.sign({
      sub: analistaId,
      email: EMAIL_ANALISTA,
      role: 'analista_seleccion',
    });
  });

  afterAll(async () => {
    // Si el beforeAll falló antes de conectar (p. ej. docker caído), no hay
    // conexión que cerrar ni filas que limpiar.
    if (!appInicializado) {
      return;
    }
    if (dataSource?.isInitialized) {
      // Limpieza atómica: si algo falla, el roll-back deja la BD dev como estaba.
      await dataSource.transaction(async (em) => {
        await em.query('DELETE FROM requerimientos WHERE jefatura = $1', [JEFATURA_FLUJO]);
        // `audit_log.changed_by` es FK con ON DELETE SET NULL: borrar usuarios
        // provocaría un UPDATE INTERNO sobre `audit_log`, que su trigger de
        // inmutabilidad rechaza. Se deshabilita SOLO dentro de esta transacción
        // (patrón del `down` de la migración 002). Las filas de `audit_log` se
        // CONSERVAN: es el rastro deseado.
        await em.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutation');
        await em.query('DELETE FROM users WHERE email = ANY($1::text[])', [
          USUARIOS_DE_PRUEBA.map((usuario) => usuario.email),
        ]);
        await em.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_mutation');
      });
    }
    await app.close();
  });

  // ───────────────────────── helpers ─────────────────────────

  /** Cuerpo VÁLIDO completo (las 5 secciones) con el título indicado. */
  function cuerpoValido(titulo: string): Record<string, unknown> {
    return {
      identificacion: {
        titulo,
        jefatura: JEFATURA_FLUJO,
        numeroPlazas: 1,
        urgencia: 'normal',
        modalidad: 'directa',
        departamentoId,
        ubicacion: 'Bogotá D.C.',
        fechaRequerida: '2026-12-01',
      },
      perfil: {
        perfilProfesional: 'Profesional de prueba de la máquina de estados',
        experienciaRequerida: '2 años de experiencia',
        nivelEducacion: 'Profesional',
      },
      conocimientos: {
        conocimientos: ['SQL'],
        habilidades: ['Comunicación asertiva'],
      },
      condiciones: {
        salarioMin: 2_800_000,
        salarioMax: 3_500_000,
        tipoContrato: 'Indefinido',
        jornada: 'Diurna',
      },
      justificacion: { justificacion: 'Prueba de la máquina de estados (Fase 3, parte 4)' },
    };
  }

  /** POST como el líder creador; devuelve el id de la fila creada. */
  async function crear(titulo: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/requerimientos')
      .set('Authorization', `Bearer ${tokenCreador}`)
      .send(cuerpoValido(titulo))
      .expect(201);
    return response.body.id as string;
  }

  /** POST a `/:id/transiciones` con el token indicado (status por quien llama). */
  function transicionar(token: string, id: string, cuerpo: Record<string, unknown>): request.Test {
    return request(app.getHttpServer())
      .post(`/api/requerimientos/${id}/transiciones`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);
  }

  // ───────────────────────── ciclo feliz ─────────────────────────

  describe('POST /:id/transiciones — ciclo con los roles correctos', () => {
    it('líder crea → admin aprueba → analista pone en proceso → admin cierra (motivo + resultado, Etapa 9)', async () => {
      const id = await crear('Ciclo feliz del flujo');

      const aprobado = await transicionar(tokenAdmin, id, {
        destino: 'aprobado',
        // Un `motivo` ajeno al rechazo/cierre se IGNORA: no debe poblar nada.
        motivo: 'esto no debe persistirse',
      }).expect(200);
      expect(aprobado.body).toMatchObject({ id, estado: 'aprobado', motivoRechazo: null });

      const enProceso = await transicionar(tokenAnalista, id, { destino: 'en_proceso' }).expect(
        200,
      );
      expect(enProceso.body).toMatchObject({ id, estado: 'en_proceso', motivoRechazo: null });

      // Etapa 9: cerrar exige MOTIVO y RESULTADO (¿se contrató o se vació?).
      const cerrado = await transicionar(tokenAdmin, id, {
        destino: 'cerrado',
        motivo: 'Vacante cubierta con contrato interno',
        resultado: 'contratacion',
      }).expect(200);
      expect(cerrado.body).toMatchObject({
        id,
        estado: 'cerrado',
        motivoRechazo: null,
        motivoCierre: 'Vacante cubierta con contrato interno',
        resultadoCierre: 'contratacion',
      });

      // Persiste en BD (lectura fresca) con la MISMA forma que el CRUD.
      const verificacion = await request(app.getHttpServer())
        .get(`/api/requerimientos/${id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);
      expect(verificacion.body.estado).toBe('cerrado');
      expect(verificacion.body.createdBy).toBe(creadorId);
      expect(verificacion.body.motivoRechazo).toBeNull();
      expect(verificacion.body.motivoCierre).toBe('Vacante cubierta con contrato interno');
      expect(verificacion.body.resultadoCierre).toBe('contratacion');

      requerimientoCerradoId = id;
    });

    it('cerrar SIN motivo → 400 y SIN resultado → 400 (Etapa 9: el cierre se traza)', async () => {
      const id = await crear('Cierre trazable');
      await transicionar(tokenAdmin, id, { destino: 'aprobado' }).expect(200);
      await transicionar(tokenAnalista, id, { destino: 'en_proceso' }).expect(200);

      const sinMotivo = await transicionar(tokenAdmin, id, {
        destino: 'cerrado',
        resultado: 'cierre_vacante',
      }).expect(400);
      expect(sinMotivo.body.message).toContain('"motivo" es obligatorio');

      const sinResultado = await transicionar(tokenAdmin, id, {
        destino: 'cerrado',
        motivo: 'La vacante ya no es necesaria',
      }).expect(400);
      expect(sinResultado.body.message).toContain('"resultado" es obligatorio');

      // Nada se escribió: sigue en proceso.
      const verificacion = await request(app.getHttpServer())
        .get(`/api/requerimientos/${id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);
      expect(verificacion.body.estado).toBe('en_proceso');
      expect(verificacion.body.motivoCierre).toBeNull();

      // Y el cierre VÁLIDO con el otro resultado también persiste.
      const cerrado = await transicionar(tokenAdmin, id, {
        destino: 'cerrado',
        motivo: 'Sin candidatos viables; se retira la plaza',
        resultado: 'cierre_vacante',
      }).expect(200);
      expect(cerrado.body).toMatchObject({
        estado: 'cerrado',
        motivoCierre: 'Sin candidatos viables; se retira la plaza',
        resultadoCierre: 'cierre_vacante',
      });
    });

    it('sobre CERRADO: el ciclo de PATCH responde 409 (solo se edita en pendiente)', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/requerimientos/${requerimientoCerradoId}`)
        .set('Authorization', `Bearer ${tokenCreador}`)
        .send({ identificacion: { titulo: 'No debería editarse' } })
        .expect(409);

      expect(response.body.message).toBe(
        'Solo se pueden editar requerimientos en estado pendiente (actual: cerrado)',
      );
    });
  });

  // ───────────────────────── rechazos ─────────────────────────

  describe('Rechazos — motivo obligatorio y regla del creador', () => {
    it('admin rechaza con motivo → 200 y el motivo persiste en GET', async () => {
      const id = await crear('Rechazo por administración');

      const rechazado = await transicionar(tokenAdmin, id, {
        destino: 'rechazado',
        motivo: `  ${MOTIVO_RECHAZO}  `,
      }).expect(200);
      expect(rechazado.body).toMatchObject({ id, estado: 'rechazado' });
      // El servicio guarda el motivo RECORTADO.
      expect(rechazado.body.motivoRechazo).toBe(MOTIVO_RECHAZO);

      const verificacion = await request(app.getHttpServer())
        .get(`/api/requerimientos/${id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);
      expect(verificacion.body.estado).toBe('rechazado');
      expect(verificacion.body.motivoRechazo).toBe(MOTIVO_RECHAZO);

      requerimientoRechazadoId = id;
    });

    it('el líder CREADOR retira SU solicitud → 200', async () => {
      const id = await crear('Retirada por su líder creador');

      const response = await transicionar(tokenCreador, id, {
        destino: 'rechazado',
        motivo: 'El área cubrió la vacante internamente',
      }).expect(200);

      expect(response.body).toMatchObject({
        id,
        estado: 'rechazado',
        motivoRechazo: 'El área cubrió la vacante internamente',
      });
    });

    it('un líder NO creador que intenta rechazar lo ajeno → 403 con la regla', async () => {
      const id = await crear('Intento de rechazo ajeno');

      const response = await transicionar(tokenOtroLider, id, {
        destino: 'rechazado',
        motivo: 'Veto indebido sobre la solicitud de otro líder',
      }).expect(403);

      expect(response.body.message).toContain('creador');
      expect(response.body.message).toContain('pendiente → rechazado');

      // Nada se escribió: sigue pendiente y sin motivo.
      const verificacion = await request(app.getHttpServer())
        .get(`/api/requerimientos/${id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);
      expect(verificacion.body).toMatchObject({ estado: 'pendiente', motivoRechazo: null });
    });
  });

  // ───────────────────────── errores 403/400/409/404 ─────────────────────────

  describe('Errores de la máquina de estados', () => {
    it('403: analista intenta aprobar pendiente (rol y transición en el mensaje)', async () => {
      const id = await crear('Analista intenta aprobar');

      const response = await transicionar(tokenAnalista, id, { destino: 'aprobado' }).expect(403);

      expect(response.body.message).toContain('analista_seleccion');
      expect(response.body.message).toContain('pendiente → aprobado');
      expect(response.body.message).toContain('admin_rrhh');
    });

    it('400: rechazar sin motivo (y NO se escribe nada)', async () => {
      const id = await crear('Rechazo sin motivo');

      const response = await transicionar(tokenAdmin, id, { destino: 'rechazado' }).expect(400);
      expect(JSON.stringify(response.body.message)).toContain('motivo');

      const verificacion = await request(app.getHttpServer())
        .get(`/api/requerimientos/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      expect(verificacion.body).toMatchObject({ estado: 'pendiente', motivoRechazo: null });
    });

    it('409: aprobado → cerrado directo (salta en_proceso) lista los destinos válidos', async () => {
      const id = await crear('Salto ilegal a cerrado');
      await transicionar(tokenAdmin, id, { destino: 'aprobado' }).expect(200);

      const response = await transicionar(tokenAdmin, id, { destino: 'cerrado' }).expect(409);

      expect(response.body.message).toContain('Transición no permitida: aprobado → cerrado');
      expect(response.body.message).toContain('[en_proceso]');
    });

    it('409: cualquier transición desde CERRADO (estado terminal)', async () => {
      for (const destino of ['aprobado', 'en_proceso', 'rechazado']) {
        const response = await transicionar(tokenAdmin, requerimientoCerradoId, {
          destino,
          motivo: 'ya cerrado',
        }).expect(409);
        expect(response.body.message).toContain('terminal');
        expect(response.body.message).toContain('cerrado');
      }
    });

    it('409: cualquier transición desde RECHAZADO (estado terminal)', async () => {
      for (const destino of ['aprobado', 'en_proceso', 'cerrado']) {
        const response = await transicionar(tokenAdmin, requerimientoRechazadoId, {
          destino,
          motivo: 'ya rechazado',
        }).expect(409);
        expect(response.body.message).toContain('terminal');
        expect(response.body.message).toContain('rechazado');
      }
    });

    it('400: destino pendiente (no hay vuelta atrás) lo rechaza el DTO', async () => {
      const id = await crear('Vuelta atrás imposible');

      const response = await transicionar(tokenAdmin, id, { destino: 'pendiente' }).expect(400);

      expect(JSON.stringify(response.body.message)).toContain('destino');
    });

    it('404 si el requerimiento no existe y 400 si el id no es uuid', async () => {
      const response = await transicionar(tokenAdmin, randomUUID(), {
        destino: 'aprobado',
      }).expect(404);
      expect(response.body.message).toContain('No existe un requerimiento');

      await transicionar(tokenAdmin, 'no-es-un-uuid', { destino: 'aprobado' }).expect(400);
    });

    it('sin token → 401 en el endpoint de transiciones', async () => {
      await request(app.getHttpServer())
        .post(`/api/requerimientos/${requerimientoCerradoId}/transiciones`)
        .send({ destino: 'aprobado' })
        .expect(401);
    });
  });

  // ───────────────────────── auditoría (migración 004) ─────────────────────────

  describe('Auditoría — audit_log registra a QUIÉN ejecuta, no al creador', () => {
    it('la cadena deja INSERT del creador + 3 UPDATE de los que ejecutaron cada paso', async () => {
      const filas = (await dataSource.query(
        `SELECT action, changed_by FROM audit_log
          WHERE table_name = 'requerimientos' AND record_id = $1
          ORDER BY id`,
        [requerimientoCerradoId],
      )) as Array<{ action: string; changed_by: string | null }>;

      expect(filas.map((fila) => fila.action)).toEqual(['INSERT', 'UPDATE', 'UPDATE', 'UPDATE']);
      // El INSERT es del líder creador (la creación no fija GUC: manda
      // `created_by`, igual que siempre).
      expect(filas[0]).toMatchObject({ action: 'INSERT', changed_by: creadorId });

      // creó el líder → aprobó el admin → puso en proceso el analista →
      // cerró el admin. SIN la migración 004 (created_by primero) las tres
      // UPDATE habrían quedado con el líder creador: el test lo detectaría.
      const cambios = filas.filter((fila) => fila.action === 'UPDATE');
      expect(cambios.map((fila) => fila.changed_by)).toEqual([adminId, analistaId, adminId]);
      expect(cambios.map((fila) => fila.changed_by)).not.toContain(creadorId);
    });

    it('el PATCH de un admin deja changed_by = admin (GUC también en edición)', async () => {
      const alta = await request(app.getHttpServer())
        .post('/api/requerimientos')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send(cuerpoValido('Auditoría del editor en PATCH'))
        .expect(201);
      const id = alta.body.id as string;

      await request(app.getHttpServer())
        .patch(`/api/requerimientos/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ justificacion: { justificacion: 'Editado por administración' } })
        .expect(200);

      const filas = (await dataSource.query(
        `SELECT changed_by FROM audit_log
          WHERE table_name = 'requerimientos' AND record_id = $1 AND action = 'UPDATE'
          ORDER BY id`,
        [id],
      )) as Array<{ changed_by: string | null }>;

      expect(filas).toHaveLength(1);
      // Sin el GUC del servicio, el trigger habría puesto `created_by` (el
      // líder); la migración 004 lo sustituye por el actor real.
      expect(filas[0]?.changed_by).toBe(adminId);
      expect(adminId).not.toBe(creadorId);
    });

    it('las transiciones DENEGADAS (403/400/409) no dejan rastro en audit_log', async () => {
      const id = await crear('Intentos fallidos sin rastro');

      await transicionar(tokenAnalista, id, { destino: 'aprobado' }).expect(403);
      await transicionar(tokenAdmin, id, { destino: 'rechazado' }).expect(400);
      await transicionar(tokenAdmin, id, { destino: 'en_proceso' }).expect(409);

      const filas = (await dataSource.query(
        `SELECT action FROM audit_log
          WHERE table_name = 'requerimientos' AND record_id = $1 AND action = 'UPDATE'`,
        [id],
      )) as Array<{ action: string }>;

      expect(filas).toHaveLength(0);
    });
  });
});
