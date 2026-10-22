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
import { ZONA_HORARIA_EMPRESA } from '../src/modules/requerimientos/codigo-generator.service';
import { RequerimientosStoreService } from '../src/modules/requerimientos/requerimientos-store.service';

/**
 * Requerimientos — Fase 3, parte 3: API CRUD con las 5 secciones, RBAC y
 * paginación, contra la BD DEV REAL de docker.
 *
 * ⚠ ESTE test usa la base de datos de desarrollo (`DATABASE_URL` del `.env`
 * raíz → localhost:5432/ats_dev), igual que el test de concurrencia del
 * generador. Motivo: el comportamiento a verificar es DE POSTGRESQL y de la
 * capa TypeORM real — CHECK`s de la migración 003, triggers de auditoría
 * (`audit_log`), enums, arrays `text[]`, `numeric` con transformer y paginación
 * con `findAndCount`. Falsear el repositorio demostraría exactamente nada y
 * sería frágil ante cualquier cambio de esquema.
 *
 * NOTA de convivencia: este fichero y `codigo-generator.concurrency.test.ts`
 * son los ÚNICOS que tocan la BD dev; el de concurrencia asegura que el
 * generador no crea filas, así que sus lecturas globales de `requerimientos`
 * pueden solaparse con las escrituras de AQUÍ si vitest ejecuta ficheros en
 * paralelo. En la práctica la ventana es de milisegundos (25 upserts) y la
 * suite completa se ha verificado repetible; de aparecer un intermitente,
 * conviene serializar la ejecución de ficheros antes que tocar aserciones.
 *
 * Aislaramiento y repetibilidad:
 *  - Los tokens JWT se firman con el `JwtService` global (mismo `JWT_SECRET`).
 *  - Los `sub` son UUIDs de usuarios REALES: el `created_by` tiene FK a
 *    `users(id)`. El admin se LEE de la BD (`admin@larco.co` del seed 002) y
 *    los usuarios de prueba se CREAN en `beforeAll` (emails únicos de test) y
 *    se BORRAN en `afterAll`.
 *  - Todos los requerimientos de prueba llevan una `jefatura` marcada con un
 *    sufijo único por ejecución, de modo que los contadores del listado son
 *    deterministas aunque la BD dev contenga otros requerimientos.
 *  - `afterAll` borra los requerimientos de prueba y sus usuarios dentro de UNA
 *    transacción. `audit_log` NO se limpia: es INMUTABLE por diseño (trigger
 *    `audit_log_no_mutation`) y conservar el rastro es correcto y esperado —
 *    de hecho, comprobar su contenido es parte del test. Para poder borrar los
 *    usuarios de prueba (la FK `audit_log.changed_by` haría `SET NULL`, que el
 *    trigger rechazaría) la transacción deshabilita y re-habilita ese trigger,
 *    el MISMO patrón que usa la migración 002 en su `down`; como va todo en
 *    una transacción, si algo falla el roll-back devuelve la BD intacta.
 */

const ADMIN_EMAIL = 'admin@larco.co';

/** Hash de mentira: estos usuarios jamás inician sesión (solo aportan un id). */
const PASSWORD_HASH_FICTICIO = 'no-utilizable-en-tests';

/** Usuarios de prueba (creados y borrados por ESTE test). */
const USUARIOS_DE_PRUEBA = [
  { email: 'req-crud-creador@larco.test', fullName: 'Test CRUD Creador', role: 'lider_area' },
  { email: 'req-crud-otro-lider@larco.test', fullName: 'Test CRUD Otro Lider', role: 'lider_area' },
  {
    email: 'req-crud-analista@larco.test',
    fullName: 'Test CRUD Analista',
    role: 'analista_seleccion',
  },
] as const;

const EMAIL_CREADOR = USUARIOS_DE_PRUEBA[0].email;
const EMAIL_OTRO_LIDER = USUARIOS_DE_PRUEBA[1].email;
const EMAIL_ANALISTA = USUARIOS_DE_PRUEBA[2].email;

/** Sufijo único por ejecución: aísla las filas de prueba del resto de la BD dev. */
const SUFIJO_UNICO = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

/** `jefatura` de los 3 requerimientos del listado (aisla los contadores). */
const JEFATURA_LISTA = `Jefatura-CRUD-LISTA-${SUFIJO_UNICO}`;

/** `jefatura` de los requerimientos creados dentro del bloque POST. */
const JEFATURA_POST = `Jefatura-CRUD-POST-${SUFIJO_UNICO}`;

/** Año actual en la zona horaria de la empresa (misma regla que el generador). */
function anioEnBogota(fecha: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HORARIA_EMPRESA, year: 'numeric' }).format(
      fecha,
    ),
  );
}

describe('Requerimientos — API CRUD e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let appInicializado = false;
  let jwt: JwtService;
  let dataSource: DataSource;

  let adminId: string;
  let creadorId: string;
  let otroLiderId: string;

  let tokenAdmin: string;
  let tokenCreador: string;
  let tokenOtroLider: string;
  let tokenAnalista: string;

  /** Los 3 requerimientos del bloque de listado: A y B pendientes, C aprobado. */
  let requerimientoA: { id: string; code: string };
  let requerimientoB: { id: string };
  let requerimientoC: { id: string };

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
    // Réplica EXACTA del ValidationPipe global de `src/main.ts`: sin él, el
    // test no cubre whitelist/forbidNonWhitelisted ni la transformación de
    // tipos (los query params llegarían como strings).
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    appInicializado = true;

    jwt = app.get(JwtService);
    const store = app.get(RequerimientosStoreService, { strict: false });
    dataSource = app.get(DataSource, { strict: false });

    // Abre la conexión LAZY del módulo (mismo patrón que el test de concurrencia).
    await store.repo();

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
    otroLiderId = idDe(EMAIL_OTRO_LIDER);

    // Tokens firmados con el MISMO secreto que la app (JwtService global).
    tokenAdmin = jwt.sign({ sub: adminId, email: ADMIN_EMAIL, role: 'admin_rrhh' });
    tokenCreador = jwt.sign({ sub: creadorId, email: EMAIL_CREADOR, role: 'lider_area' });
    tokenOtroLider = jwt.sign({ sub: otroLiderId, email: EMAIL_OTRO_LIDER, role: 'lider_area' });
    tokenAnalista = jwt.sign({
      sub: idDe(EMAIL_ANALISTA),
      email: EMAIL_ANALISTA,
      role: 'analista_seleccion',
    });

    // Fixtures del bloque de listado/detalle/patch (3 requerimientos creados).
    requerimientoA = await crearFixture(JEFATURA_LISTA, 'Requerimiento A');
    requerimientoB = await crearFixture(JEFATURA_LISTA, 'Requerimiento B');
    requerimientoC = await crearFixture(JEFATURA_LISTA, 'Requerimiento C');

    // Simular la parte 4 (máquina de estados) para tener un NO pendiente:
    // escritura DIRECTA en BD a propósito, sin pasar por la API (todavía no
    // expone transiciones). El trigger de auditoría deja constancia del cambio.
    await dataSource.query('UPDATE requerimientos SET estado = $1 WHERE id = $2', [
      'aprobado',
      requerimientoC.id,
    ]);
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
        await em.query('DELETE FROM requerimientos WHERE jefatura = ANY($1::text[])', [
          [JEFATURA_LISTA, JEFATURA_POST],
        ]);
        // `audit_log.changed_by` es FK con ON DELETE SET NULL: borrar usuarios
        // provocaría un UPDATE sobre `audit_log`, que su trigger de inmutabilidad
        // rechaza. Se deshabilita SOLO dentro de esta transacción (patrón del
        // `down` de la migración 002). Las filas de `audit_log` se CONSERVAN.
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

  /** Cuerpo VÁLIDO completo (las 5 secciones), con la `jefatura` indicada. */
  function cuerpoValido(jefatura: string): Record<string, unknown> {
    return {
      identificacion: {
        titulo: 'Analista de Selección Senior',
        jefatura,
        numeroPlazas: 2,
        ubicacion: 'Bogotá D.C.',
        fechaRequerida: '2026-12-01',
      },
      perfil: {
        experienciaRequerida: '3 años en reclutamiento',
        nivelEducacion: 'Profesional',
        perfilProfesional: 'Profesional orientado a selección de talento',
      },
      conocimientos: {
        conocimientos: ['SQL', 'NestJS'],
        habilidades: ['Comunicación asertiva', 'Negociación'],
      },
      condiciones: {
        salarioMin: 2_800_000,
        salarioMax: 4_200_000,
        tipoContrato: 'Indefinido',
        jornada: 'Diurna',
      },
      justificacion: { justificacion: 'Cobertura de vacante generada por rotación' },
    };
  }

  /** POST como el creador y devuelve la fila creada (con id y code). */
  async function crearFixture(
    jefatura: string,
    titulo: string,
  ): Promise<{ id: string; code: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/requerimientos')
      .set('Authorization', `Bearer ${tokenCreador}`)
      .send({
        ...cuerpoValido(jefatura),
        identificacion: {
          ...(cuerpoValido(jefatura).identificacion as Record<string, unknown>),
          titulo,
        },
      })
      .expect(201);
    return { id: response.body.id as string, code: response.body.code as string };
  }

  /** GET paginado con el filtro de `jefatura` del test (aislamiento). */
  function listar(jefatura: string, extra = ''): request.Test {
    return request(app.getHttpServer())
      .get(`/api/requerimientos?jefatura=${encodeURIComponent(jefatura)}${extra}`)
      .set('Authorization', `Bearer ${tokenAnalista}`);
  }

  // ───────────────────────── POST ─────────────────────────

  describe('POST /api/requerimientos', () => {
    it('con rol analista_seleccion → 403 (solo lider_area, admin_rrhh y superusuario)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/requerimientos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send(cuerpoValido(JEFATURA_POST))
        .expect(403);

      expect(response.body.message).toBe('No tienes permiso para realizar esta acción');
    });

    it('con rol lider_area → 201 con code REQ-<año>-NNN, estado pendiente y created_by del JWT', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/requerimientos')
        .set('Authorization', `Bearer ${tokenCreador}`)
        .send(cuerpoValido(JEFATURA_POST))
        .expect(201);

      expect(response.body.code).toMatch(new RegExp(`^REQ-${anioEnBogota()}-[0-9]{3,}$`));
      expect(response.body.estado).toBe('pendiente');
      expect(response.body.createdBy).toBe(creadorId);
      expect(response.body.id).toEqual(expect.any(String));
      // Secciones 3 y 4 se devuelven tal cual se enviaron.
      expect(response.body.conocimientos).toEqual(['SQL', 'NestJS']);
      expect(response.body.salarioMin).toBe(2_800_000);
      expect(response.body.fechaRequerida).toBe('2026-12-01');
    });

    it('con un campo no permitido (estado) en el cuerpo → 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/requerimientos')
        .set('Authorization', `Bearer ${tokenCreador}`)
        .send({ ...cuerpoValido(JEFATURA_POST), estado: 'aprobado' })
        .expect(400);

      // forbidNonWhitelisted nombra el campo rechazado.
      expect(JSON.stringify(response.body.message)).toContain('estado');
    });

    it('sin secciones obligatorias (conocimientos y justificacion) → 400', async () => {
      const cuerpo = cuerpoValido(JEFATURA_POST) as Record<string, Record<string, unknown>>;
      delete cuerpo.conocimientos;
      delete cuerpo.justificacion;

      const response = await request(app.getHttpServer())
        .post('/api/requerimientos')
        .set('Authorization', `Bearer ${tokenCreador}`)
        .send(cuerpo)
        .expect(400);

      const mensajes = JSON.stringify(response.body.message);
      expect(mensajes).toContain('conocimientos');
      expect(mensajes).toContain('justificacion');
    });

    it('con salarioMin > salarioMax → 400 con mensaje en español', async () => {
      const cuerpo = cuerpoValido(JEFATURA_POST) as Record<string, Record<string, unknown>>;
      cuerpo.condiciones = { ...cuerpo.condiciones, salarioMin: 9_000_000, salarioMax: 1_000_000 };

      const response = await request(app.getHttpServer())
        .post('/api/requerimientos')
        .set('Authorization', `Bearer ${tokenCreador}`)
        .send(cuerpo)
        .expect(400);

      expect(JSON.stringify(response.body.message)).toContain(
        'El salario mínimo no puede ser mayor que el salario máximo',
      );
    });
  });

  // ───────────────────────── GET listado ─────────────────────────

  describe('GET /api/requerimientos (listado paginado)', () => {
    it('devuelve { items, total, page, limit } con orden created_at DESC', async () => {
      const response = await listar(JEFATURA_LISTA).expect(200);

      expect(response.body).toMatchObject({
        total: 3,
        page: 1,
        limit: 20,
      });
      expect(response.body.items).toHaveLength(3);
      // Orden descendente por fecha de creación.
      const fechas = response.body.items.map((item: { createdAt: string }) => item.createdAt);
      const ordenadas = [...fechas].sort().reverse();
      expect(fechas).toEqual(ordenadas);
    });

    it('filtra por estado (pendientes vs aprobados)', async () => {
      const pendientes = await listar(JEFATURA_LISTA, '&estado=pendiente').expect(200);
      expect(pendientes.body.total).toBe(2);
      expect(
        pendientes.body.items.every((item: { estado: string }) => item.estado === 'pendiente'),
      ).toBe(true);

      const aprobados = await listar(JEFATURA_LISTA, '&estado=aprobado').expect(200);
      expect(aprobados.body.total).toBe(1);
      expect(aprobados.body.items[0].id).toBe(requerimientoC.id);
    });

    it('pagina con limit=1 (1 item por página y total correcto)', async () => {
      const pagina1 = await listar(JEFATURA_LISTA, '&limit=1').expect(200);
      expect(pagina1.body.items).toHaveLength(1);
      expect(pagina1.body.total).toBe(3);
      expect(pagina1.body.limit).toBe(1);

      const pagina2 = await listar(JEFATURA_LISTA, '&limit=1&page=2').expect(200);
      expect(pagina2.body.items).toHaveLength(1);
      expect(pagina2.body.total).toBe(3);

      // Páginas distintas (sin solape) contienen filas distintas.
      expect(pagina2.body.items[0].id).not.toBe(pagina1.body.items[0].id);
    });

    it('rechaza limit > 100 y page < 1 con 400', async () => {
      await listar(JEFATURA_LISTA, '&limit=101').expect(400);
      await listar(JEFATURA_LISTA, '&page=0').expect(400);
    });
  });

  // ───────────────────────── GET detalle ─────────────────────────

  describe('GET /api/requerimientos/:id', () => {
    it('devuelve 200 con el detalle completo del requerimiento', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/requerimientos/${requerimientoA.id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: requerimientoA.id,
        code: requerimientoA.code,
        estado: 'pendiente',
        titulo: 'Requerimiento A',
        jefatura: JEFATURA_LISTA,
        numeroPlazas: 2,
        perfilProfesional: 'Profesional orientado a selección de talento',
        habilidades: ['Comunicación asertiva', 'Negociación'],
      });
    });

    it('devuelve 404 con mensaje claro si el id no existe', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/requerimientos/${randomUUID()}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(404);

      expect(response.body.message).toContain('No existe un requerimiento');
    });

    it('devuelve 400 si el id no es un uuid', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/requerimientos/no-es-un-uuid')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);

      expect(response.body.message).toBe(
        'El identificador del requerimiento debe ser un UUID válido',
      );
    });
  });

  // ───────────────────────── PATCH ─────────────────────────

  describe('PATCH /api/requerimientos/:id', () => {
    it('el CREADOR en estado pendiente → 200 y los cambios persisten', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/requerimientos/${requerimientoA.id}`)
        .set('Authorization', `Bearer ${tokenCreador}`)
        .send({
          identificacion: { numeroPlazas: 5 },
          condiciones: { salarioMax: 5_000_000 },
        })
        .expect(200);

      expect(response.body.numeroPlazas).toBe(5);
      expect(response.body.salarioMax).toBe(5_000_000);
      // Los campos NO mencionados quedan intactos.
      expect(response.body.titulo).toBe('Requerimiento A');
      expect(response.body.estado).toBe('pendiente');
      expect(response.body.code).toBe(requerimientoA.code);

      const verificacion = await request(app.getHttpServer())
        .get(`/api/requerimientos/${requerimientoA.id}`)
        .set('Authorization', `Bearer ${tokenCreador}`)
        .expect(200);
      expect(verificacion.body.numeroPlazas).toBe(5);
      expect(verificacion.body.salarioMax).toBe(5_000_000);
    });

    it('otro líder (NO creador) → 403', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/requerimientos/${requerimientoB.id}`)
        .set('Authorization', `Bearer ${tokenOtroLider}`)
        .send({ identificacion: { titulo: 'Intento ajeno' } })
        .expect(403);

      expect(response.body.message).toBe(
        'Solo el creador del requerimiento o un administrador de RRHH pueden modificarlo',
      );
    });

    it('admin_rrhh NO creador → 200 (puede editar)', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/requerimientos/${requerimientoB.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ justificacion: { justificacion: 'Editado por administración' } })
        .expect(200);

      expect(response.body.justificacion).toBe('Editado por administración');
      expect(response.body.createdBy).toBe(creadorId); // la autoría no cambia
    });

    it('con estado en el cuerpo → 400 (el DTO no lo acepta)', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/requerimientos/${requerimientoB.id}`)
        .set('Authorization', `Bearer ${tokenCreador}`)
        .send({ estado: 'rechazado' })
        .expect(400);

      expect(JSON.stringify(response.body.message)).toContain('estado');
    });

    it('cuando NO está en pendiente → 409 con el estado actual', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/requerimientos/${requerimientoC.id}`)
        .set('Authorization', `Bearer ${tokenCreador}`)
        .send({ identificacion: { titulo: 'No debería editarse' } })
        .expect(409);

      expect(response.body.message).toBe(
        'Solo se pueden editar requerimientos en estado pendiente (actual: aprobado)',
      );
    });

    it('devuelve 404 si el requerimiento no existe', async () => {
      await request(app.getHttpServer())
        .patch(`/api/requerimientos/${randomUUID()}`)
        .set('Authorization', `Bearer ${tokenCreador}`)
        .send({ identificacion: { titulo: 'Fantasma' } })
        .expect(404);
    });

    it('valida el rango salarial RESULTANTE contra lo guardado (400, no 500)', async () => {
      // A tiene salarioMax = 5.000.000 tras el primer PATCH: subir el mínimo
      // por encima debe responder 400, no el 500 del CHECK de BD.
      const response = await request(app.getHttpServer())
        .patch(`/api/requerimientos/${requerimientoA.id}`)
        .set('Authorization', `Bearer ${tokenCreador}`)
        .send({ condiciones: { salarioMin: 9_000_000 } })
        .expect(400);

      expect(JSON.stringify(response.body.message)).toContain(
        'El salario mínimo no puede ser mayor que el salario máximo',
      );
    });
  });

  // ───────────────────────── auditoría ─────────────────────────

  describe('Auditoría (audit_log de la propia BD)', () => {
    it('el POST deja una fila INSERT con changed_by = creador', async () => {
      const filas = (await dataSource.query(
        `SELECT action, changed_by FROM audit_log
          WHERE table_name = 'requerimientos' AND record_id = $1
          ORDER BY id`,
        [requerimientoA.id],
      )) as Array<{ action: string; changed_by: string | null }>;

      expect(filas.length).toBeGreaterThan(0);
      expect(filas[0]).toMatchObject({ action: 'INSERT', changed_by: creadorId });
    });

    it('el PATCH deja una fila UPDATE con el mismo changed_by', async () => {
      const filas = (await dataSource.query(
        `SELECT action, changed_by FROM audit_log
          WHERE table_name = 'requerimientos' AND record_id = $1 AND action = 'UPDATE'
          ORDER BY id`,
        [requerimientoA.id],
      )) as Array<{ action: string; changed_by: string | null }>;

      // El creador hizo UN solo PATCH válido sobre A; los intentos inválidos
      // (400/403/409) no escriben nada, así que no dejan rastro en audit_log.
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ action: 'UPDATE', changed_by: creadorId });
    });
  });

  // ───────────────────────── ping (regresión) ─────────────────────────

  it('GET /api/requerimientos/ping sigue respondiendo el placeholder', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/requerimientos/ping')
      .set('Authorization', `Bearer ${tokenCreador}`)
      .expect(200);

    expect(response.body).toEqual({ modulo: 'requerimientos', status: 'placeholder' });
  });

  it('sin token → 401 en todos los endpoints del módulo', async () => {
    await request(app.getHttpServer()).get('/api/requerimientos').expect(401);
    await request(app.getHttpServer()).get(`/api/requerimientos/${randomUUID()}`).expect(401);
    await request(app.getHttpServer()).post('/api/requerimientos').expect(401);
    await request(app.getHttpServer()).patch(`/api/requerimientos/${randomUUID()}`).expect(401);
  });
});
