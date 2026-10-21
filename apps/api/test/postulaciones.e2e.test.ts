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
import type { EntradaHistorialPostulacionDto } from '../src/modules/embudo/postulaciones.mapper';

/**
 * Postulaciones — Fase 5, parte backend: el embudo de selección por 5 fases,
 * contra la BD DEV REAL de docker.
 *
 * ⚠ ESTE test usa la base de datos de desarrollo (`DATABASE_URL` del `.env`
 * raíz → localhost:5432/ats_dev), igual que el resto de e2e que tocan BD.
 * Motivo: lo que se verifica ES de PostgreSQL y de la capa real — los CHECK
 * `postulaciones_descarte_check` y `postulaciones_contratacion_check`, el
 * índice único `postulaciones_candidato_requerimiento_unique`, el trigger
 * `postulaciones_audit_log` con el GUC del actor (migración 004/007) y la
 * escritura `UPDATE ... WHERE estado = <origen>` dentro de transacción.
 * Falsear el pool demostraría exactamente nada.
 *
 * ACCESO A LA BD: el pool `pg` GLOBAL (`DatabaseService`), MISMO acceso que
 * usa el propio módulo `embudo` (y el que tiene ventaja: siendo un singleton
 * global no hay ambigüedad como con los DataSource de TypeORM).
 *
 * AISLAMIENTO Y REPETIBILIDAD:
 *  - Tokens JWT firmados con el `JwtService` global (mismo `JWT_SECRET`).
 *  - `sub` = UUIDs de usuarios REALES (FK `created_by` → `users(id)`): el
 *    admin sale del seed 002 (`admin@larco.co`); el analista y el líder se
 *    CREAN en `beforeAll` y se BORRAN en `afterAll`.
 *  - Candidatos marcados por `apellidos` con un sufijo único; requerimientos
 *    por `jefatura`. Los `id` de las postulaciones de prueba se derivan de
 *    esos requerimientos, así que la limpieza es de una sola pasada.
 *  - Cédulas con prefijo ALEATORIO (`randomInt`), NUNCA `Date.now()`: otros
 *    ficheros de e2e comparten el patrón y un timestamp idéntico al cargar en
 *    el mismo milisegundo provocaría 409 en el beforeAll.
 *  - `afterAll` borra postulaciones → candidatos → requerimientos → usuarios
 *    en UNA transacción (deshabilita `audit_log_no_mutation` SOLO ahí, patrón
 *    de 002/crud, para poder borrar usuarios referenciados por
 *    `audit_log.changed_by`). `audit_log` NO se limpia: es INMUTABLE y
 *    comprobar su contenido ES parte del test.
 *
 * ORDEN: los `it` comparten estado y siguen el orden de escritura (mismo
 * criterio que `candidatos-crud` o `requerimientos-flujo`); cada bloque usa su
 * propio requerimiento para no acoplarse al anterior.
 */

const ADMIN_EMAIL = 'admin@larco.co';

/** Hash de mentira: estos usuarios jamás inician sesión (solo aportan un id). */
const PASSWORD_HASH_FICTICIO = 'no-utilizable-en-tests';

/** Usuarios de prueba (creados y borrados por ESTE test). */
const USUARIOS_DE_PRUEBA = [
  {
    email: 'embudo-analista@larco.test',
    fullName: 'Test Embudo Analista',
    role: 'analista_seleccion',
  },
  { email: 'embudo-lider@larco.test', fullName: 'Test Embudo Lider', role: 'lider_area' },
] as const;

const EMAIL_ANALISTA = USUARIOS_DE_PRUEBA[0].email;
const EMAIL_LIDER = USUARIOS_DE_PRUEBA[1].email;

/** Sufijo único por ejecución: aísla las filas de prueba del resto de la BD dev. */
const SUFIJO_UNICO = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

/** `jefatura` de TODOS los requerimientos de prueba (limpieza de una vez). */
const JEFATURA = `Jefatura-EMBUDO-${SUFIJO_UNICO}`;

/** `apellidos` de TODOS los candidatos de prueba (la marca de limpieza). */
const APELLIDOS_MARCA = `EmbudoPrueba ${SUFIJO_UNICO}`;

/**
 * Cédulas únicas por ejecución (9 dígitos, como exige el DTO). Prefijo
 * ALEATORIO, no `Date.now()`: evita el flake entre workers descrito arriba.
 */
const BASE_CEDULA = randomInt(1000000, 10000000).toString();
const CEDULA_A = `${BASE_CEDULA}11`;
const CEDULA_B = `${BASE_CEDULA}22`;
const CEDULA_C = `${BASE_CEDULA}33`;

/** Motivo canónico del descarte que SÍ debe persistir. */
const MOTIVO_DESCARTE = 'No cubre el perfil del requerimiento';

/** Mensaje exacto que el DTO y el servicio devuelven cuando falta el motivo. */
const MENSAJE_MOTIVO = 'El motivo de descarte es obligatorio';

/** Las 5 fases en orden de avance (las usa la cadena feliz). */
const FASES_EN_ORDEN = [
  'preseleccion',
  'antecedentes',
  'entrevistas',
  'proveedor_externo',
  'contratacion',
] as const;

describe('Postulaciones — embudo de selección e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let appInicializado = false;
  let jwt: JwtService;
  let database: DatabaseService;

  let adminId: string;
  let analistaId: string;

  let tokenAdmin: string;
  let tokenAnalista: string;
  let tokenLider: string;

  /** 3 candidatos de prueba, creados por API (con PII cifrada real). */
  let candidatoA: { id: string };
  let candidatoB: { id: string };
  let candidatoC: { id: string };

  /** `en_proceso`: lo usan POST, la cadena feliz, los saltos y el descarte. */
  let requerimientoActivo: { id: string };
  /** `en_proceso`: exclusivo del bloque de LISTADO (agrupación y paginación). */
  let requerimientoListado: { id: string };
  /** Sigue `pendiente`: sirve para el 409 de «solo en proceso». */
  let requerimientoPendiente: { id: string };

  /** Postulación creada en el bloque POST (candidatoA → requerimientoActivo). */
  let postulacionPrincipal: { id: string };
  /** CandidatoB → requerimientoActivo: la que recorre TODAS las fases. */
  let postulacionCadena: { id: string };
  /** CandidatoC → requerimientoActivo: saltos, retrocesos y errores de forma. */
  let postulacionSalto: { id: string };

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || url.includes('127.0.0.1:5555')) {
      // test-env fija esa URL falsa como último recurso: aquí haría falta la
      // BD dev real. Falla temprano y con mensaje claro si docker no corre.
      throw new Error(
        'Este test necesita la BD dev de docker: revisa docker-compose.dev.yml y el .env raíz (DATABASE_URL)',
      );
    }

    // AppModule REAL, sin overrides: la máquina de fases, la transacción con GUC
    // y los CHECK de la 007 son exactamente los de producción.
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
    database = app.get(DatabaseService, { strict: false });

    // El admin del seed 002 es el único admin_rrhh real de la BD dev.
    const admins = (await database.query('SELECT id FROM users WHERE email = $1', [
      ADMIN_EMAIL,
    ])) as { rows: Array<{ id: string }> };
    adminId = admins.rows[0]?.id ?? '';
    if (adminId === '') {
      throw new Error(
        `No se encontró el usuario ${ADMIN_EMAIL}: ejecuta las migraciones (pnpm --filter @ats/api db:migrate)`,
      );
    }

    // Usuarios de prueba (FK `created_by` → `users(id)`: hacen falta UUIDs reales).
    for (const usuario of USUARIOS_DE_PRUEBA) {
      await database.query(
        `INSERT INTO users (role_id, email, password_hash, full_name, active)
         SELECT r.id, $1, $2, $3, true FROM roles r WHERE r.code = $4
         ON CONFLICT (email) DO NOTHING`,
        [usuario.email, PASSWORD_HASH_FICTICIO, usuario.fullName, usuario.role],
      );
    }

    const usuarios = await database.query(
      'SELECT id, email FROM users WHERE email = ANY($1::text[])',
      [USUARIOS_DE_PRUEBA.map((usuario) => usuario.email)],
    );

    const idDe = (email: string): string => {
      const id = (usuarios.rows as Array<{ id: string; email: string }>).find(
        (usuario) => usuario.email === email,
      )?.id;
      if (id === undefined) {
        throw new Error(`El usuario de prueba ${email} no pudo crearse en la BD dev`);
      }
      return id;
    };
    analistaId = idDe(EMAIL_ANALISTA);

    // Tokens firmados con el MISMO secreto que la app (JwtService global).
    tokenAdmin = jwt.sign({ sub: adminId, email: ADMIN_EMAIL, role: 'admin_rrhh' });
    tokenAnalista = jwt.sign({
      sub: analistaId,
      email: EMAIL_ANALISTA,
      role: 'analista_seleccion',
    });
    tokenLider = jwt.sign({ sub: idDe(EMAIL_LIDER), email: EMAIL_LIDER, role: 'lider_area' });

    // Fixtures: 3 candidatos creados VÍA API (PII cifrada de verdad).
    candidatoA = await crearCandidato('Ana', CEDULA_A);
    candidatoB = await crearCandidato('Berta', CEDULA_B);
    candidatoC = await crearCandidato('Carlos', CEDULA_C);

    // 3 requerimientos: dos EN PROCESO (líder crea → admin aprueba → analista
    // inicia) y uno que sigue PENDIENTE para el 409 del POST.
    requerimientoActivo = { id: await crearRequerimientoEnProceso('Vacante activa del embudo') };
    requerimientoListado = { id: await crearRequerimientoEnProceso('Vacante del tablero') };
    requerimientoPendiente = await crearRequerimiento('Vacante aún no aprobada');
  });

  afterAll(async () => {
    // Si el beforeAll falló antes de conectar (p. ej. docker caído), no hay
    // conexión que cerrar ni filas que limpiar.
    if (!appInicializado || database === undefined) {
      return;
    }

    const requerimientos = [requerimientoActivo, requerimientoListado, requerimientoPendiente]
      .map((requerimiento) => requerimiento?.id)
      .filter((id): id is string => typeof id === 'string');

    // Limpieza atómica: si algo falla, el roll-back deja la BD dev como estaba.
    const cliente = await database.pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('DELETE FROM postulaciones WHERE requerimiento_id = ANY($1::uuid[])', [
        requerimientos,
      ]);
      await cliente.query('DELETE FROM candidatos WHERE apellidos = $1', [APELLIDOS_MARCA]);
      await cliente.query('DELETE FROM requerimientos WHERE jefatura = $1', [JEFATURA]);
      // `audit_log.changed_by` es FK con ON DELETE SET NULL: borrar usuarios
      // provocaría un UPDATE sobre `audit_log`, que su trigger de inmutabilidad
      // rechaza. Se deshabilita SOLO dentro de esta transacción. Las filas de
      // `audit_log` se CONSERVAN (inmutables por diseño).
      await cliente.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutation');
      await cliente.query('DELETE FROM users WHERE email = ANY($1::text[])', [
        USUARIOS_DE_PRUEBA.map((usuario) => usuario.email),
      ]);
      await cliente.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_mutation');
      await cliente.query('COMMIT');
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }

    await app.close();
  });

  // ───────────────────────── helpers ─────────────────────────

  /** Cuerpo VÁLIDO de un requerimiento (las 5 secciones, patrón del CRUD). */
  function cuerpoRequerimiento(titulo: string): Record<string, unknown> {
    return {
      identificacion: {
        titulo,
        jefatura: JEFATURA,
        numeroPlazas: 1,
        ubicacion: 'Bogotá D.C.',
      },
      perfil: { perfilProfesional: 'Profesional de prueba del embudo de selección' },
      conocimientos: { conocimientos: ['SQL'], habilidades: ['Comunicación asertiva'] },
      condiciones: { salarioMin: 2_800_000, salarioMax: 3_500_000 },
      justificacion: { justificacion: 'Prueba del embudo de selección (Fase 5)' },
    };
  }

  /** POST un candidato como el analista y devuelve `{ id }`. */
  async function crearCandidato(nombres: string, cedula: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/candidatos')
      .set('Authorization', `Bearer ${tokenAnalista}`)
      .send({
        nombres: `${nombres} ${SUFIJO_UNICO}`,
        apellidos: APELLIDOS_MARCA,
        cedula,
      })
      .expect(201);
    return { id: response.body.id as string };
  }

  /** POST un requerimiento como el líder creador → `{ id }` (estado `pendiente`). */
  async function crearRequerimiento(titulo: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/requerimientos')
      .set('Authorization', `Bearer ${tokenLider}`)
      .send(cuerpoRequerimiento(titulo))
      .expect(201);
    return { id: response.body.id as string };
  }

  /** Crea el requerimiento y lo lleva a `en_proceso` por la máquina de estados. */
  async function crearRequerimientoEnProceso(titulo: string): Promise<string> {
    const requerimiento = await crearRequerimiento(titulo);
    await transicionarRequerimiento(requerimiento.id, 'aprobado', tokenAdmin);
    await transicionarRequerimiento(requerimiento.id, 'en_proceso', tokenAnalista);
    return requerimiento.id;
  }

  /** POST `/api/requerimientos/:id/transiciones` con el token indicado. */
  function transicionarRequerimiento(id: string, destino: string, token: string): request.Test {
    return request(app.getHttpServer())
      .post(`/api/requerimientos/${id}/transiciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({ destino });
  }

  /** POST una postulación con el token indicado (status lo decide quien llama). */
  function crearPostulacion(
    candidatoId: string,
    requerimientoId: string,
    token: string,
  ): request.Test {
    return request(app.getHttpServer())
      .post('/api/postulaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ candidatoId, requerimientoId });
  }

  /** PATCH `/api/postulaciones/:id/fase` con el token indicado. */
  function mover(
    id: string,
    fase: string,
    token: string,
    cuerpoExtra: Record<string, unknown> = {},
  ): request.Test {
    return request(app.getHttpServer())
      .patch(`/api/postulaciones/${id}/fase`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fase, ...cuerpoExtra });
  }

  /** POST `/api/postulaciones/:id/descarte` con el token indicado. */
  function descartar(id: string, token: string, cuerpo: Record<string, unknown>): request.Test {
    return request(app.getHttpServer())
      .post(`/api/postulaciones/${id}/descarte`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);
  }

  /** Fila cruda de `postulaciones` (para comprobar la verdad de la BD). */
  async function filaEnBD(id: string): Promise<{
    fase: string;
    estado: string;
    motivo_descarte: string | null;
  }> {
    const resultado = await database.query(
      'SELECT fase, estado, motivo_descarte FROM postulaciones WHERE id = $1',
      [id],
    );
    const fila = (
      resultado.rows as Array<{ fase: string; estado: string; motivo_descarte: string | null }>
    )[0];
    if (fila === undefined) {
      throw new Error(`La postulación ${id} no existe en la BD dev`);
    }
    return fila;
  }

  // ───────────────────────── POST ─────────────────────────

  describe('POST /api/postulaciones', () => {
    it('analista crea → 201 en preseleccion/activa con la forma EXACTA (created_by del JWT)', async () => {
      const response = await crearPostulacion(
        candidatoA.id,
        requerimientoActivo.id,
        tokenAnalista,
      ).expect(201);

      // Forma PÚBLICA completa: ni una clave de más (snake_case, columnas
      // internas ni la fase/estado que el cliente NO elige).
      expect(response.body).toEqual({
        id: expect.any(String),
        candidatoId: candidatoA.id,
        requerimientoId: requerimientoActivo.id,
        fase: 'preseleccion',
        estado: 'activa',
        motivoDescarte: null,
        createdBy: analistaId,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(Object.keys(response.body).sort()).toEqual([
        'candidatoId',
        'createdAt',
        'createdBy',
        'estado',
        'fase',
        'id',
        'motivoDescarte',
        'requerimientoId',
        'updatedAt',
      ]);

      postulacionPrincipal = { id: response.body.id as string };
    });

    it('el mismo candidato en el MISMO requerimiento → 409 (única por par, incluida la carrera)', async () => {
      const response = await crearPostulacion(
        candidatoA.id,
        requerimientoActivo.id,
        tokenAnalista,
      ).expect(409);

      expect(response.body.statusCode).toBe(409);
      expect(response.body.message).toContain('ya tiene una postulación');

      // Solo existe UNA fila para ese par (candidato, requerimiento).
      const resultado = await database.query(
        'SELECT count(*)::int AS n FROM postulaciones WHERE candidato_id = $1 AND requerimiento_id = $2',
        [candidatoA.id, requerimientoActivo.id],
      );
      expect((resultado.rows as Array<{ n: number }>)[0]?.n).toBe(1);
    });

    it('con rol lider_area → 403 (solo analista_seleccion y admin_rrhh)', async () => {
      const response = await crearPostulacion(
        candidatoB.id,
        requerimientoActivo.id,
        tokenLider,
      ).expect(403);

      expect(response.body.message).toBe('No tienes permiso para realizar esta acción');
    });

    it('a un requerimiento que NO está en proceso (pendiente) → 409 con el estado actual', async () => {
      const response = await crearPostulacion(
        candidatoB.id,
        requerimientoPendiente.id,
        tokenAnalista,
      ).expect(409);

      expect(response.body.message).toContain('en proceso');
      expect(response.body.message).toContain("'pendiente'");

      // Nada quedó registrado en el requerimiento que no estaba en proceso.
      const resultado = await database.query(
        'SELECT count(*)::int AS n FROM postulaciones WHERE requerimiento_id = $1',
        [requerimientoPendiente.id],
      );
      expect((resultado.rows as Array<{ n: number }>)[0]?.n).toBe(0);
    });

    it('un candidato INEXISTENTE → 404 (antes de mirar el requerimiento)', async () => {
      const response = await crearPostulacion(
        randomUUID(),
        requerimientoActivo.id,
        tokenAnalista,
      ).expect(404);

      expect(response.body.message).toContain('No existe un candidato');
    });

    it('un requerimiento INEXISTENTE → 404', async () => {
      const response = await crearPostulacion(candidatoB.id, randomUUID(), tokenAnalista).expect(
        404,
      );

      expect(response.body.message).toContain('No existe un requerimiento');
    });

    it('un candidatoId que no es uuid → 400 (lo dice el DTO)', async () => {
      const response = await crearPostulacion(
        'no-es-uuid',
        requerimientoActivo.id,
        tokenAnalista,
      ).expect(400);

      expect(JSON.stringify(response.body.message)).toContain('candidatoId debe ser un UUID');
    });

    it('con campos que el cliente NO escribe (fase/estado) → 400 por forbidNonWhitelisted', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/postulaciones')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({
          candidatoId: candidatoC.id,
          requerimientoId: requerimientoActivo.id,
          fase: 'contratacion',
          estado: 'contratado',
        })
        .expect(400);

      const mensajes = JSON.stringify(response.body.message);
      expect(mensajes).toContain('fase');
      expect(mensajes).toContain('estado');
    });

    it('sin token → 401', async () => {
      await request(app.getHttpServer())
        .post('/api/postulaciones')
        .send({ candidatoId: candidatoA.id, requerimientoId: requerimientoActivo.id })
        .expect(401);
    });
  });

  // ───────────────────────── GET listado ─────────────────────────

  describe('GET /api/postulaciones (tablero y paginación)', () => {
    beforeAll(async () => {
      // 3 postulaciones en el requerimiento del tablero; una de ellas avanza a
      // `antecedentes` para poder comprobar el AGRUPADO por fase.
      await crearPostulacion(candidatoA.id, requerimientoListado.id, tokenAnalista).expect(201);
      const respuestaB = await crearPostulacion(
        candidatoB.id,
        requerimientoListado.id,
        tokenAnalista,
      ).expect(201);
      await crearPostulacion(candidatoC.id, requerimientoListado.id, tokenAnalista).expect(201);

      await mover(respuestaB.body.id as string, 'antecedentes', tokenAnalista).expect(200);
    });

    it('filtra por requerimientoId y cada item trae su fase (el frontend agrupa por `fase`)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/postulaciones?requerimientoId=${requerimientoListado.id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(response.body.total).toBe(3);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(50);

      const porCandidato = new Map<string, string>(
        (response.body.items as Array<{ candidatoId: string; fase: string }>).map((item) => [
          item.candidatoId,
          item.fase,
        ]),
      );
      expect(porCandidato.get(candidatoA.id)).toBe('preseleccion');
      expect(porCandidato.get(candidatoB.id)).toBe('antecedentes');
      expect(porCandidato.get(candidatoC.id)).toBe('preseleccion');

      // Orden created_at DESC: las fechas nunca ascendentes.
      const fechas = (response.body.items as Array<{ createdAt: string }>).map(
        (item) => item.createdAt,
      );
      expect(fechas).toEqual([...fechas].sort().reverse());
    });

    it('filtra por fase y por estado, combinables con el requerimiento', async () => {
      const porFase = await request(app.getHttpServer())
        .get(`/api/postulaciones?requerimientoId=${requerimientoListado.id}&fase=preseleccion`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(porFase.body.total).toBe(2);
      expect(
        (porFase.body.items as Array<{ fase: string }>).every(
          (item) => item.fase === 'preseleccion',
        ),
      ).toBe(true);

      const activas = await request(app.getHttpServer())
        .get(`/api/postulaciones?requerimientoId=${requerimientoListado.id}&estado=activa`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);
      expect(activas.body.total).toBe(3);

      const descartadas = await request(app.getHttpServer())
        .get(`/api/postulaciones?requerimientoId=${requerimientoListado.id}&estado=descartado`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);
      expect(descartadas.body.total).toBe(0);
      expect(descartadas.body.items).toEqual([]);
    });

    it('filtra por candidatoId (una fila por requerimiento: el par es único)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/postulaciones?candidatoId=${candidatoB.id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      // El candidatoB solo postuló al tablero: la postulación de la cadena
      // (otro requerimiento) todavía no existe.
      expect(response.body.total).toBe(1);
      expect((response.body.items as Array<{ fase: string }>)[0]?.fase).toBe('antecedentes');
    });

    it('pagina con limit=1 (1 item por página, total correcto y páginas sin solape)', async () => {
      const pagina1 = await request(app.getHttpServer())
        .get(`/api/postulaciones?requerimientoId=${requerimientoListado.id}&limit=1`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(pagina1.body.items).toHaveLength(1);
      expect(pagina1.body.total).toBe(3);
      expect(pagina1.body.limit).toBe(1);

      const pagina2 = await request(app.getHttpServer())
        .get(`/api/postulaciones?requerimientoId=${requerimientoListado.id}&limit=1&page=2`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(pagina2.body.items).toHaveLength(1);
      expect(pagina2.body.page).toBe(2);
      // Páginas distintas (sin solape) contienen filas distintas.
      expect((pagina2.body.items as Array<{ id: string }>)[0]?.id).not.toBe(
        (pagina1.body.items as Array<{ id: string }>)[0]?.id,
      );
    });

    it('rechaza limit > 100, page < 1 y un requerimientoId que no es uuid', async () => {
      await request(app.getHttpServer())
        .get(`/api/postulaciones?requerimientoId=${requerimientoListado.id}&limit=101`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);
      await request(app.getHttpServer())
        .get(`/api/postulaciones?requerimientoId=${requerimientoListado.id}&page=0`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/postulaciones?requerimientoId=no-es-uuid')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);
      await request(app.getHttpServer())
        .get(`/api/postulaciones?fase=${'no-existe'}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);
    });

    it('con el rol lider_area también se puede consultar (cualquier rol autenticado)', async () => {
      await request(app.getHttpServer())
        .get(`/api/postulaciones?requerimientoId=${requerimientoListado.id}`)
        .set('Authorization', `Bearer ${tokenLider}`)
        .expect(200);
    });

    it('sin token → 401', async () => {
      await request(app.getHttpServer()).get('/api/postulaciones').expect(401);
    });
  });

  // ───────────────────────── GET detalle ─────────────────────────

  describe('GET /api/postulaciones/:id', () => {
    it('devuelve 200 con la postulación creada en el bloque POST', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/postulaciones/${postulacionPrincipal.id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: postulacionPrincipal.id,
        candidatoId: candidatoA.id,
        requerimientoId: requerimientoActivo.id,
        fase: 'preseleccion',
        estado: 'activa',
        motivoDescarte: null,
        createdBy: analistaId,
      });
    });

    it('devuelve 400 si el id no es un uuid (mismo mensaje en todos los endpoints)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/postulaciones/no-es-un-uuid')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);

      expect(response.body.message).toBe(
        'El identificador de la postulación debe ser un UUID válido',
      );
    });

    it('devuelve 404 con mensaje claro si no existe', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/postulaciones/${randomUUID()}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(404);

      expect(response.body.message).toContain('No existe una postulación');
    });
  });

  // ───────────────────────── PATCH :id/fase ─────────────────────────

  describe('PATCH /api/postulaciones/:id/fase — la cadena completa del embudo', () => {
    it('preseleccion → antecedentes → entrevistas → proveedor_externo → contratacion (4 movimientos de un paso, todos 200)', async () => {
      const respuesta = await crearPostulacion(
        candidatoB.id,
        requerimientoActivo.id,
        tokenAnalista,
      ).expect(201);
      postulacionCadena = { id: respuesta.body.id as string };

      // 4 fases consecutivas = 5 fases del tablero − 1: cada movimiento avanza
      // EXACTAMENTE un paso y la respuesta refleja la fase ya materializada.
      for (const [indice, fase] of FASES_EN_ORDEN.slice(1).entries()) {
        const anterior = FASES_EN_ORDEN[indice];
        const respuestaMovimiento = await mover(postulacionCadena.id, fase, tokenAnalista).expect(
          200,
        );

        expect(respuestaMovimiento.body).toMatchObject({
          id: postulacionCadena.id,
          fase,
          // Contratación ES contratar: estado terminal en la MISMA escritura.
          estado: fase === 'contratacion' ? 'contratado' : 'activa',
          motivoDescarte: null,
        });
        // El resto de campos quedan intactos.
        expect(respuestaMovimiento.body.candidatoId).toBe(candidatoB.id);
        expect(respuestaMovimiento.body.requerimientoId).toBe(requerimientoActivo.id);
        expect(respuestaMovimiento.body.createdBy).toBe(analistaId);
        expect(anterior).toBeDefined();
      }

      // La verdad de la BD coincide con lo que devolvió la API.
      expect(await filaEnBD(postulacionCadena.id)).toMatchObject({
        fase: 'contratacion',
        estado: 'contratado',
        motivo_descarte: null,
      });
    });

    it('un movimiento MÁS sobre la terminal (contratado) → 409', async () => {
      const response = await mover(postulacionCadena.id, 'proveedor_externo', tokenAnalista).expect(
        409,
      );

      expect(response.body.statusCode).toBe(409);
      expect(response.body.message).toContain('Estado terminal');
      expect(response.body.message).toContain("'contratado'");
    });

    it('descartar una YA CONTRATADA → 409 (terminal también para el descarte)', async () => {
      const response = await descartar(postulacionCadena.id, tokenAnalista, {
        motivo: 'Contrato ya firmado',
      }).expect(409);

      expect(response.body.message).toContain('Estado terminal');
      // Ni el estado ni el motivo cambiaron.
      expect(await filaEnBD(postulacionCadena.id)).toMatchObject({
        estado: 'contratado',
        motivo_descarte: null,
      });
    });

    it('con rol lider_area → 403 y sin token → 401', async () => {
      await mover(postulacionPrincipal.id, 'antecedentes', tokenLider).expect(403);

      await request(app.getHttpServer())
        .patch(`/api/postulaciones/${postulacionPrincipal.id}/fase`)
        .send({ fase: 'antecedentes' })
        .expect(401);
    });
  });

  describe('PATCH /api/postulaciones/:id/fase — errores de la máquina de fases', () => {
    beforeAll(async () => {
      const respuesta = await crearPostulacion(
        candidatoC.id,
        requerimientoActivo.id,
        tokenAnalista,
      ).expect(201);
      postulacionSalto = { id: respuesta.body.id as string };
    });

    it('un SALTO de fase (preseleccion → entrevistas) → 409 «Solo se puede mover un paso»', async () => {
      const response = await mover(postulacionSalto.id, 'entrevistas', tokenAnalista).expect(409);

      expect(response.body.statusCode).toBe(409);
      expect(response.body.message).toContain('Solo se puede mover un paso');
      expect(response.body.message).toContain("'preseleccion'");
      expect(response.body.message).toContain("'entrevistas'");
      // El salto también se puede intentar hacia ATRÁS: mismo rechazo.
      const atras = await mover(postulacionSalto.id, 'contratacion', tokenAnalista).expect(409);
      expect(atras.body.message).toContain('Solo se puede mover un paso');

      // Nada se escribió: sigue en preseleccion/activa.
      expect(await filaEnBD(postulacionSalto.id)).toMatchObject({
        fase: 'preseleccion',
        estado: 'activa',
      });
    });

    it('la MISMA fase que la actual → 409 (no hay nada que mover)', async () => {
      const response = await mover(postulacionSalto.id, 'preseleccion', tokenAnalista).expect(409);

      expect(response.body.message).toContain('ya está en la fase');
      expect(response.body.message).toContain("'preseleccion'");
    });

    it('un movimiento HACIA ATRÁS un paso → 200 (el Kanban permite regresar)', async () => {
      await mover(postulacionSalto.id, 'antecedentes', tokenAnalista).expect(200);

      const respuesta = await mover(postulacionSalto.id, 'preseleccion', tokenAnalista).expect(200);
      expect(respuesta.body).toMatchObject({
        id: postulacionSalto.id,
        fase: 'preseleccion',
        estado: 'activa',
      });
    });

    it('una fase que no existe en el ENUM → 400 (lo rechaza el DTO)', async () => {
      const response = await mover(postulacionSalto.id, 'contratado', tokenAnalista).expect(400);

      expect(JSON.stringify(response.body.message)).toContain('fase debe ser una de');
      expect(await filaEnBD(postulacionSalto.id)).toMatchObject({ fase: 'preseleccion' });
    });

    it('404 si la postulación no existe y 400 si el id no es uuid', async () => {
      const respuesta = await mover(randomUUID(), 'antecedentes', tokenAnalista).expect(404);
      expect(respuesta.body.message).toContain('No existe una postulación');

      await request(app.getHttpServer())
        .patch('/api/postulaciones/no-es-un-uuid/fase')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ fase: 'antecedentes' })
        .expect(400);
    });
  });

  // ───────────────────────── descarte ─────────────────────────

  describe('POST /api/postulaciones/:id/descarte — motivo obligatorio', () => {
    it('sin el campo motivo → 400 con el mensaje exacto', async () => {
      const response = await descartar(postulacionPrincipal.id, tokenAnalista, {}).expect(400);

      expect(JSON.stringify(response.body.message)).toContain(MENSAJE_MOTIVO);
      expect(await filaEnBD(postulacionPrincipal.id)).toMatchObject({ estado: 'activa' });
    });

    it('con un motivo SOLO de espacios → 400 (el servicio recorta antes de escribir)', async () => {
      await descartar(postulacionPrincipal.id, tokenAnalista, { motivo: '    ' }).expect(400);
      expect(await filaEnBD(postulacionPrincipal.id)).toMatchObject({
        estado: 'activa',
        motivo_descarte: null,
      });
    });

    it('con motivo → 200, estado descartado y el motivo RECORTADO en la respuesta y en BD', async () => {
      const response = await descartar(postulacionPrincipal.id, tokenAnalista, {
        motivo: `  ${MOTIVO_DESCARTE}  `,
      }).expect(200);

      expect(response.body).toMatchObject({
        id: postulacionPrincipal.id,
        fase: 'preseleccion', // el descarte NO mueve de fase
        estado: 'descartado',
        motivoDescarte: MOTIVO_DESCARTE,
      });

      expect(await filaEnBD(postulacionPrincipal.id)).toMatchObject({
        estado: 'descartado',
        motivo_descarte: MOTIVO_DESCARTE,
      });
    });

    it('tras el descarte: mover de fase → 409 y descartar otra vez → 409 (terminal)', async () => {
      const alMover = await mover(postulacionPrincipal.id, 'antecedentes', tokenAnalista).expect(
        409,
      );
      expect(alMover.body.message).toContain('Estado terminal');
      expect(alMover.body.message).toContain("'descartado'");

      const alDescartar = await descartar(postulacionPrincipal.id, tokenAnalista, {
        motivo: 'Segundo intento indebido',
      }).expect(409);
      expect(alDescartar.body.message).toContain('Estado terminal');

      // El motivo ORIGINAL es el único que quedó.
      expect(await filaEnBD(postulacionPrincipal.id)).toMatchObject({
        motivo_descarte: MOTIVO_DESCARTE,
      });
    });

    it('con rol lider_area → 403 y sin token → 401', async () => {
      await descartar(postulacionSalto.id, tokenLider, { motivo: 'Veto indebido' }).expect(403);
      await request(app.getHttpServer())
        .post(`/api/postulaciones/${postulacionSalto.id}/descarte`)
        .send({ motivo: 'Sin autenticar' })
        .expect(401);
    });

    it('la BASE DE DATOS impide el descarte sin motivo (CHECK postulaciones_descarte_check)', async () => {
      // Escritura CRUDA, sin pasar por la API: el CHECK es la red de seguridad
      // final aunque un cliente o una migración future intenten saltárselo.
      const descarteSinMotivo = database.query(
        `INSERT INTO postulaciones (candidato_id, requerimiento_id, estado, created_by)
         VALUES ($1, $2, 'descartado', $3)`,
        [candidatoA.id, requerimientoPendiente.id, analistaId],
      );
      await expect(descarteSinMotivo).rejects.toThrow(/postulaciones_descarte_check/);

      // Y una postulación ACTIVA tampoco puede llevar motivo de descarte.
      const activaConMotivo = database.query(
        `INSERT INTO postulaciones (candidato_id, requerimiento_id, estado, motivo_descarte, created_by)
         VALUES ($1, $2, 'activa', 'Motivo imposible', $3)`,
        [candidatoB.id, requerimientoPendiente.id, analistaId],
      );
      await expect(activaConMotivo).rejects.toThrow(/postulaciones_descarte_check/);

      // Tampoco puede quedar `activa` en la fase de contratación ni un
      // `contratado` a mitad del embudo (CHECK contratacion_check).
      const activaEnContratacion = database.query(
        `INSERT INTO postulaciones (candidato_id, requerimiento_id, fase, estado, created_by)
         VALUES ($1, $2, 'contratacion', 'activa', $3)`,
        [candidatoA.id, requerimientoPendiente.id, analistaId],
      );
      await expect(activaEnContratacion).rejects.toThrow(/postulaciones_contratacion_check/);

      const contratadoFueraDeContratacion = database.query(
        `INSERT INTO postulaciones (candidato_id, requerimiento_id, fase, estado, created_by)
         VALUES ($1, $2, 'antecedentes', 'contratado', $3)`,
        [candidatoB.id, requerimientoPendiente.id, analistaId],
      );
      await expect(contratadoFueraDeContratacion).rejects.toThrow(
        /postulaciones_contratacion_check/,
      );

      // Ninguno de los intentos dejó fila detrás.
      const resultado = await database.query(
        'SELECT count(*)::int AS n FROM postulaciones WHERE requerimiento_id = $1',
        [requerimientoPendiente.id],
      );
      expect((resultado.rows as Array<{ n: number }>)[0]?.n).toBe(0);
    });
  });

  // ───────────────────────── historial ─────────────────────────

  describe('GET /api/postulaciones/:id/historial — audit_log', () => {
    it('registra el alta y cada movimiento de fase, con changed_by del QUE lo hizo', async () => {
      // Esta postulación ya retrocedió 2 pasos en el bloque anterior (2 UPDATE
      // del analista) y ahora avanzan 2 más: el 2.º lo ejecuta el ADMIN para
      // demostrar que changed_by sigue al actor real, no al creador.
      await mover(postulacionSalto.id, 'antecedentes', tokenAnalista).expect(200);
      await mover(postulacionSalto.id, 'entrevistas', tokenAdmin).expect(200);

      const response = await request(app.getHttpServer())
        .get(`/api/postulaciones/${postulacionSalto.id}/historial`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      const entradas = response.body as EntradaHistorialPostulacionDto[];

      // Alta + 4 movimientos (2 retrocesos + 2 avances) = 5 escrituras, en
      // created_at DESC: lo último primero, el alta al final.
      expect(entradas).toHaveLength(5);
      expect(entradas.map((entrada) => entrada.accion)).toEqual([
        'UPDATE',
        'UPDATE',
        'UPDATE',
        'UPDATE',
        'INSERT',
      ]);

      // El diff de CADA movimiento nombra la fase anterior y la nueva.
      expect(entradas[0]?.campos).toEqual([
        { campo: 'fase', antes: 'antecedentes', despues: 'entrevistas' },
      ]);
      expect(entradas[1]?.campos).toEqual([
        { campo: 'fase', antes: 'preseleccion', despues: 'antecedentes' },
      ]);
      // Los 2 retrocesos del bloque anterior también quedaron registrados.
      expect(entradas[2]?.campos).toEqual([
        { campo: 'fase', antes: 'antecedentes', despues: 'preseleccion' },
      ]);
      expect(entradas[3]?.campos).toEqual([
        { campo: 'fase', antes: 'preseleccion', despues: 'antecedentes' },
      ]);
      // El alta informa fase y estado con `antes: null` (el motivo, al ser
      // NULL, no se lista).
      expect(entradas[4]?.campos).toEqual([
        { campo: 'fase', antes: null, despues: 'preseleccion' },
        { campo: 'estado', antes: null, despues: 'activa' },
      ]);

      // ACTOR de cada escritura (DESC): ADMIN en el último movimiento y el
      // analista en todo lo demás, incluida la escritura del alta.
      expect(entradas.map((entrada) => entrada.usuario)).toEqual([
        adminId,
        analistaId,
        analistaId,
        analistaId,
        analistaId,
      ]);
      expect(entradas[0]?.usuarioEmail).toBe(ADMIN_EMAIL);
      for (const entrada of entradas) {
        expect(typeof entrada.id).toBe('string');
        // `fecha` es ISO 8601 estricto (round-trip estable).
        expect(new Date(entrada.fecha).toISOString()).toBe(entrada.fecha);
      }
    });

    it('el descarte deja su motivo en el historial (los 3 campos de negocio)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/postulaciones/${postulacionPrincipal.id}/historial`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      const entradas = response.body as EntradaHistorialPostulacionDto[];
      expect(entradas[0]?.accion).toBe('UPDATE');
      expect(entradas[0]?.campos).toEqual([
        { campo: 'estado', antes: 'activa', despues: 'descartado' },
        { campo: 'motivoDescarte', antes: null, despues: MOTIVO_DESCARTE },
      ]);
      expect(entradas[0]?.usuario).toBe(analistaId);

      // Las claves internas (FKs, created_by, timestamps) NO se exponen.
      const texto = JSON.stringify(entradas);
      expect(texto).not.toMatch(/candidato_id|requerimiento_id|created_by|created_at/);
    });

    it('devuelve 400 si el id no es uuid y 404 si la postulación no existe', async () => {
      await request(app.getHttpServer())
        .get('/api/postulaciones/no-es-un-uuid/historial')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);

      const respuesta = await request(app.getHttpServer())
        .get(`/api/postulaciones/${randomUUID()}/historial`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(404);
      expect(respuesta.body.message).toContain('No existe una postulación');
    });

    it('está disponible para cualquier rol autenticado (lider_area)', async () => {
      await request(app.getHttpServer())
        .get(`/api/postulaciones/${postulacionPrincipal.id}/historial`)
        .set('Authorization', `Bearer ${tokenLider}`)
        .expect(200);
    });
  });

  // ───────────────────────── auditoría (audit_log en BD) ─────────────────────────

  describe('Auditoría — audit_log registra a QUIÉN ejecuta, no al creador', () => {
    it('la cadena deja INSERT del creador + 3 UPDATE con changed_by de cada actor', async () => {
      const resultado = await database.query(
        `SELECT action, changed_by FROM audit_log
          WHERE table_name = 'postulaciones' AND record_id = $1
          ORDER BY id`,
        [postulacionSalto.id],
      );
      const filas = resultado.rows as Array<{ action: string; changed_by: string | null }>;

      expect(filas.map((fila) => fila.action)).toEqual([
        'INSERT',
        'UPDATE',
        'UPDATE',
        'UPDATE',
        'UPDATE',
      ]);
      // El INSERT es del analista (sin GUC en el alta manda `created_by`).
      expect(filas[0]).toMatchObject({ action: 'INSERT', changed_by: analistaId });

      // creó el analista → movió el analista 3 veces (los retrocesos y el
      // primer avance) → movió el ADMIN (el último avance). Sin el GUC de la
      // migración 004 las UPDATE habrían quedado con el creador de la fila:
      // el test lo detectaría.
      const cambios = filas.filter((fila) => fila.action === 'UPDATE');
      expect(cambios.map((fila) => fila.changed_by)).toEqual([
        analistaId,
        analistaId,
        analistaId,
        adminId,
      ]);
      expect(cambios.map((fila) => fila.changed_by)).not.toContain(candidatoC.id);
    });

    it('las operaciones DENEGADAS (403/400/409) no dejan rastro en audit_log', async () => {
      // Sobre la postulación de la cadena (terminal desde hace varios bloques)
      // se intentaron un movimiento y un descarte indebidos: cero escrituras.
      const resultado = await database.query(
        `SELECT count(*)::int AS n FROM audit_log
          WHERE table_name = 'postulaciones' AND record_id = $1 AND action = 'UPDATE'`,
        [postulacionCadena.id],
      );
      // 4 movimientos legítimos de la cadena; los intentos posteriores (409)
      // no añaden NI UNA fila más.
      expect((resultado.rows as Array<{ n: number }>)[0]?.n).toBe(4);
    });

    it('el UPDATE de un descarte fija changed_by = el actor (GUC en la transacción)', async () => {
      const resultado = await database.query(
        `SELECT changed_by FROM audit_log
          WHERE table_name = 'postulaciones' AND record_id = $1 AND action = 'UPDATE'
          ORDER BY id DESC LIMIT 1`,
        [postulacionPrincipal.id],
      );
      expect((resultado.rows as Array<{ changed_by: string | null }>)[0]?.changed_by).toBe(
        analistaId,
      );
    });
  });

  // ───────────────────────── regresiones del andamiaje ─────────────────────────

  it('GET /api/embudo/ping sigue respondiendo el placeholder de la Fase 1', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/embudo/ping')
      .set('Authorization', `Bearer ${tokenAnalista}`)
      .expect(200);

    expect(response.body).toEqual({ modulo: 'embudo', status: 'placeholder' });
  });
});
