import './helpers/dev-db-env'; // ANTES que test-env: carga el .env raíz (BD dev docker)
import './helpers/test-env';

import { createHmac, randomInt, randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import type { Candidato } from '../src/modules/candidatos/candidato.entity';
import { CandidatosStoreService } from '../src/modules/candidatos/candidatos-store.service';

/**
 * Candidatos — Fase 4, parte 1: API CRUD con PII cifrada (cédula y teléfono) y
 * hash de búsqueda, contra la BD DEV REAL de docker.
 *
 * ⚠ ESTE test usa la base de datos de desarrollo (`DATABASE_URL` del `.env`
 * raíz → localhost:5432/ats_dev). Motivo: el comportamiento a verificar es DE
 * POSTGRESQL y de la capa TypeORM real — CHECK`s de la migración 005 (formato
 * `v1:...` cifrado, hash en hex), el índice único de `cedula_hash`, los
 * triggers de auditoría (`audit_log`) y el filtro ILIKE—. Falsear el
 * repositorio demostraría exactamente nada.
 *
 * ACCESO A LA BD: se usa el `DataSource` LAZY del propio módulo de candidatos
 * (vía `CandidatosStoreService.repo()`), NO `app.get(DataSource)`. Motivo: al
 * registrar tanto `CandidatosModule` como `RequerimientosModule` su PROPIO
 * `DataSource` (mismo patrón), `app.get(DataSource)` sería ambiguo (Nest
 * devuelve el último). Aquí se evita la ambigüedad usando el repo del store y
 * su `EntityManager` para las consultas crudas y la limpieza.
 *
 * Aislamiento y repetibilidad (mismo criterio que `requerimientos-crud`):
 *  - Los tokens JWT se firman con el `JwtService` global (mismo `JWT_SECRET`).
 *  - Los `sub` son UUIDs de usuarios REALES (el `created_by` tiene FK a
 *    `users(id)`): el admin se LEE de la BD y los usuarios de prueba se CREAN
 *    en `beforeAll` y se BORRAN en `afterAll`.
 *  - Todos los candidatos de prueba llevan una `ciudad` marcada con un sufijo
 *    único por ejecución, de modo que la limpieza es determinista aunque la BD
 *    dev contenga otros candidatos.
 *  - `afterAll` borra los candidatos de prueba y sus usuarios dentro de UNA
 *    transacción. `audit_log` NO se limpia: es INMUTABLE por diseño y conservar
 *    el rastro es correcto y esperado. Para poder borrar los usuarios de prueba
 *    (la FK `audit_log.changed_by` haría `SET NULL`, que el trigger rechazaría)
 *    la transacción deshabilita y re-habilita ese trigger (patrón del `down`
 *    de la migración 002).
 */

const ADMIN_EMAIL = 'admin@larco.co';

/** IT del seed 008: el `superusuario`, único rol ajeno que puede borrar candidatos. */
const SUPER_EMAIL = 'it@larco.co';

/** Hash de mentira: estos usuarios jamás inician sesión (solo aportan un id). */
const PASSWORD_HASH_FICTICIO = 'no-utilizable-en-tests';

/** Usuarios de prueba (creados y borrados por ESTE test). */
const USUARIOS_DE_PRUEBA = [
  {
    email: 'cand-crud-analista@larco.test',
    fullName: 'Test Cand Analista',
    role: 'analista_seleccion',
  },
  {
    email: 'cand-crud-analista-otro@larco.test',
    fullName: 'Test Cand Analista Otro',
    role: 'analista_seleccion',
  },
  { email: 'cand-crud-lider@larco.test', fullName: 'Test Cand Lider', role: 'lider_area' },
] as const;

const EMAIL_ANALISTA = USUARIOS_DE_PRUEBA[0].email;
const EMAIL_ANALISTA_OTRO = USUARIOS_DE_PRUEBA[1].email;
const EMAIL_LIDER = USUARIOS_DE_PRUEBA[2].email;

/** Sufijo único por ejecución: aísla las filas de prueba del resto de la BD dev. */
const SUFIJO_UNICO = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

/** `ciudad` de TODOS los candidatos de prueba: es la marca que usa la limpieza. */
const MARCA = `Ciudad-Cand-${SUFIJO_UNICO}`;

/** Token de texto único para probar el filtro `q` (ILIKE) sobre `nombres`. */
const TOKEN_Q = `Quimbaya${SUFIJO_UNICO}`;

/**
 * Cédulas únicas por ejecución (6-10 dígitos, como exige el DTO): prefijo de
 * 7 dígitos ALEATORIO por ejecución. No se usa `Date.now()`: varios workers de
 * Vitest cargan estos módulos en el mismo milisegundo y el timestamp es idéntico
 * entre ficheros, lo que hacía chocar `cedula_hash` (409 en el beforeAll y todo
 * el archivo salteado). Cada una cumple un papel distinto en el guion del test.
 */
const BASE_CEDULA = randomInt(1000000, 10000000).toString();
/** Cédula del candidato principal (fixtures de GET/filtros/403). */
const CEDULA_PRINCIPAL = `${BASE_CEDULA}11`;
/** Cédula original del candidato "Baltasar" (servirá de colisión). */
const CEDULA_COLISION = `${BASE_CEDULA}22`;
/** Cédula del candidato creado dentro del bloque POST. */
const CEDULA_POST = `${BASE_CEDULA}33`;
/** Cédula NUEVA que el creador asigna a "Baltasar" en el primer PATCH. */
const CEDULA_EDITADA = `${BASE_CEDULA}44`;
/** Cédulas de los fixtures del bloque DELETE (corrección posterior a la Etapa 9). */
const CEDULA_BORRABLE = `${BASE_CEDULA}55`;
const CEDULA_BORRABLE_IT = `${BASE_CEDULA}66`;
const CEDULA_LIGADA = `${BASE_CEDULA}77`;

/**
 * HMAC-SHA-256 (hex) de una cédula con la llave REAL del entorno: sirve de
 * oráculo independiente para comprobar que en BD el `cedula_hash` es el HMAC
 * y NO el texto plano.
 */
function hmacDeCedula(cedula: string): string {
  const llave = process.env.CEDULA_SEARCH_KEY;
  if (!llave) {
    throw new Error('Falta CEDULA_SEARCH_KEY en el entorno (test-env la fija)');
  }
  return createHmac('sha256', Buffer.from(llave, 'base64')).update(cedula, 'utf8').digest('hex');
}

describe('Candidatos — API CRUD e2e con PII cifrada (BD dev docker real)', () => {
  let app: INestApplication;
  let appInicializado = false;
  let jwt: JwtService;

  // Repo LAZY del módulo de candidatos: da acceso a SQL crudo y a transacciones
  // SIN depender de la resolución ambigua de `app.get(DataSource)`.
  let repo: Repository<Candidato>;
  let store: CandidatosStoreService;

  let adminId: string;
  let creadorId: string;
  let superId: string;

  let tokenAdmin: string;
  let tokenAnalista: string;
  let tokenAnalistaOtro: string;
  let tokenLider: string;
  let tokenSuper: string;

  /** Candidato principal: PII, GET, filtros y 403 de no-creador. */
  let candidatoPrincipal: { id: string };

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || url.includes('127.0.0.1:5555')) {
      // test-env fija esa URL falsa como último recurso: aquí haría falta la
      // BD dev real. Falla temprano y con mensaje claro si docker no corre.
      throw new Error(
        'Este test necesita la BD dev de docker: revisa docker-compose.dev.yml y el .env raíz (DATABASE_URL)',
      );
    }

    // AppModule REAL, sin overrides: el DataSource del módulo de candidatos se
    // inicializa de forma perezosa al primer uso (patrón de la parte 1).
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
    store = app.get(CandidatosStoreService, { strict: false });

    // Abre la conexión LAZY del módulo de candidatos y da el repo para SQL crudo.
    repo = await store.repo();

    // El admin del seed 002 es el único admin_rrhh real de la BD dev.
    const admins = (await repo.query('SELECT id FROM users WHERE email = $1', [
      ADMIN_EMAIL,
    ])) as Array<{ id: string }>;
    adminId = admins[0]?.id ?? '';
    if (adminId === '') {
      throw new Error(
        `No se encontró el usuario ${ADMIN_EMAIL}: ejecuta las migraciones (pnpm --filter @ats/api db:migrate)`,
      );
    }

    // El IT del seed 008: el ÚNICO rol (junto al creador) que puede borrar
    // candidatos ajenos (corrección posterior a la Etapa 9).
    const supers = (await repo.query('SELECT id FROM users WHERE email = $1', [
      SUPER_EMAIL,
    ])) as Array<{ id: string }>;
    superId = supers[0]?.id ?? '';
    if (superId === '') {
      throw new Error(
        `No se encontró el usuario ${SUPER_EMAIL}: ejecuta las migraciones (pnpm --filter @ats/api db:migrate)`,
      );
    }

    // Usuarios de prueba (FK `created_by` → `users(id)`: hacen falta UUIDs reales).
    for (const usuario of USUARIOS_DE_PRUEBA) {
      await repo.query(
        `INSERT INTO users (role_id, email, password_hash, full_name, active)
         SELECT r.id, $1, $2, $3, true FROM roles r WHERE r.code = $4
         ON CONFLICT (email) DO NOTHING`,
        [usuario.email, PASSWORD_HASH_FICTICIO, usuario.fullName, usuario.role],
      );
    }

    const usuarios = (await repo.query(
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
    creadorId = idDe(EMAIL_ANALISTA);

    // Tokens firmados con el MISMO secreto que la app (JwtService global).
    tokenAdmin = jwt.sign({ sub: adminId, email: ADMIN_EMAIL, role: 'admin_rrhh' });
    tokenAnalista = jwt.sign({
      sub: creadorId,
      email: EMAIL_ANALISTA,
      role: 'analista_seleccion',
    });
    tokenAnalistaOtro = jwt.sign({
      sub: idDe(EMAIL_ANALISTA_OTRO),
      email: EMAIL_ANALISTA_OTRO,
      role: 'analista_seleccion',
    });
    tokenLider = jwt.sign({ sub: idDe(EMAIL_LIDER), email: EMAIL_LIDER, role: 'lider_area' });
    tokenSuper = jwt.sign({ sub: superId, email: SUPER_EMAIL, role: 'superusuario' });

    // Fixtures: el candidato principal (para GET/filtros/403) y un segundo
    // candidato que servirá de "colisión" de cédula en el PATCH.
    candidatoPrincipal = await crearFixture('Zoraida', CEDULA_PRINCIPAL, TOKEN_Q);
    await crearFixture('Baltasar', CEDULA_COLISION, 'OtroNombre');
  });

  afterAll(async () => {
    // Si el beforeAll falló antes de conectar (p. ej. docker caído), no hay
    // conexión que cerrar ni filas que limpiar.
    if (!appInicializado) {
      return;
    }
    if (store) {
      // Limpieza atómica: si algo falla, el roll-back deja la BD dev como estaba.
      await store.withTransaction(async (em) => {
        // Los candidatos de prueba se marcan por `ciudad` (no la toca ningún PATCH).
        await em.query('DELETE FROM candidatos WHERE ciudad = $1', [MARCA]);
        // `audit_log.changed_by` es FK con ON DELETE SET NULL: borrar usuarios
        // provocaría un UPDATE sobre `audit_log`, que su trigger de inmutabilidad
        // rechaza. Se deshabilita SOLO dentro de esta transacción. Las filas de
        // `audit_log` se CONSERVAN.
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

  /** POST un candidato como el analista creador y devuelve `{ id }`. */
  async function crearFixture(
    nombres: string,
    cedula: string,
    tokenNombre: string,
  ): Promise<{ id: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/candidatos')
      .set('Authorization', `Bearer ${tokenAnalista}`)
      .send({
        nombres: `${nombres} ${tokenNombre}`,
        apellidos: `Prueba ${SUFIJO_UNICO}`,
        cedula,
        ciudad: MARCA,
      })
      .expect(201);
    return { id: response.body.id as string };
  }

  /** Cuerpo VÁLIDO de creación, con la cédula indicada. */
  function cuerpoValido(cedula: string): Record<string, unknown> {
    return {
      nombres: `Zoraida ${TOKEN_Q}`,
      apellidos: `Prueba ${SUFIJO_UNICO}`,
      email: `candidato-${SUFIJO_UNICO}@mail.test`,
      cedula,
      telefono: '3001234567',
      ciudad: MARCA,
      cargoActual: 'Ingeniera de Datos',
      expectativaSalarial: 4_500_000,
      disponibilidad: 'Inmediata',
      notas: 'Búsqueda por referencia',
    };
  }

  // ───────────────────────── POST ─────────────────────────

  describe('POST /api/candidatos', () => {
    it('con rol analista_seleccion → 201 con la cédula DESCIFRADA y sin el hash interno', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send(cuerpoValido(CEDULA_POST))
        .expect(201);

      expect(response.body.id).toEqual(expect.any(String));
      expect(response.body.createdBy).toBe(creadorId);
      // La PII se devuelve en claro para el cliente autenticado…
      expect(response.body.cedula).toBe(CEDULA_POST);
      expect(response.body.telefono).toBe('3001234567');
      // …pero NUNCA se expone el hash de búsqueda ni las columnas cifradas.
      expect(response.body).not.toHaveProperty('cedulaHash');
      expect(response.body).not.toHaveProperty('cedulaCifrada');
      expect(response.body).not.toHaveProperty('telefonoCifrada');
    });

    it('en BD la cédula queda CIFRADA (v1:) y el hash NO es el texto plano', async () => {
      // El candidato de prueba del bloque POST usa CEDULA_POST; se localiza por
      // su ciudad marcada para aislarlo del resto de la BD dev.
      const filas = (await repo.query(
        'SELECT cedula_cifrada, telefono_cifrada, cedula_hash FROM candidatos WHERE ciudad = $1',
        [MARCA],
      )) as Array<{ cedula_cifrada: string; telefono_cifrada: string; cedula_hash: string }>;

      const fila = filas.find((f) => f.cedula_hash === hmacDeCedula(CEDULA_POST));
      expect(fila).toBeDefined();
      if (!fila) {
        return;
      }

      // Cifrada con el esquema vigente ( CHECK `... LIKE 'v1:%'` lo garantiza).
      expect(fila.cedula_cifrada.startsWith('v1:')).toBe(true);
      expect(fila.telefono_cifrada.startsWith('v1:')).toBe(true);
      // El texto plano NO aparece en ninguna columna.
      expect(fila.cedula_cifrada).not.toContain(CEDULA_POST);
      expect(JSON.stringify(fila)).not.toContain(CEDULA_POST);
      // El hash es el HMAC-SHA-256 (hex) esperado, distinto del texto plano.
      expect(fila.cedula_hash).toBe(hmacDeCedula(CEDULA_POST));
      expect(fila.cedula_hash).not.toBe(CEDULA_POST);
    });

    it('con la MISMA cédula (duplicado) → 409 con mensaje claro', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ ...cuerpoValido(CEDULA_POST), email: undefined, nombres: 'Duplicado' })
        .expect(409);

      expect(response.body.message).toBe('Ya existe un candidato con esa cédula');
    });

    it('con rol lider_area → 403 (solo analista_seleccion, admin_rrhh y superusuario)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenLider}`)
        .send(cuerpoValido(`${CEDULA_POST}9`))
        .expect(403);

      expect(response.body.message).toBe('No tienes permiso para realizar esta acción');
    });

    it('con una cédula inválida (texto) → 400 con mensaje en español', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ ...cuerpoValido('1234'), cedula: 'no-es-cedula' })
        .expect(400);

      expect(JSON.stringify(response.body.message)).toContain('cédula válida');
    });

    it('con un campo interno no permitido (cedulaCifrada) en el cuerpo → 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ ...cuerpoValido(`${CEDULA_POST}8`), cedulaCifrada: 'v1:x:y' })
        .expect(400);

      expect(JSON.stringify(response.body.message)).toContain('cedulaCifrada');
    });

    it('nombres o apellidos de UNA letra → 400 (Etapa 9: mínimo 3 caracteres)', async () => {
      const nombresCortos = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ ...cuerpoValido(`${CEDULA_POST}7`), nombres: 'P' })
        .expect(400);
      expect(JSON.stringify(nombresCortos.body.message)).toContain('al menos 3 caracteres');

      const apellidosCortos = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ ...cuerpoValido(`${CEDULA_POST}6`), apellidos: 'Si' })
        .expect(400);
      expect(JSON.stringify(apellidosCortos.body.message)).toContain('al menos 3 caracteres');
    });

    it('un email inválido o notas que superan el límite → 400 (Etapa 9)', async () => {
      const emailInvalido = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ ...cuerpoValido(`${CEDULA_POST}5`), email: 'no-es-un-correo' })
        .expect(400);
      expect(JSON.stringify(emailInvalido.body.message)).toContain('correo electrónico válido');

      const notasLargas = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ ...cuerpoValido(`${CEDULA_POST}4`), notas: 'x'.repeat(2001) })
        .expect(400);
      expect(JSON.stringify(notasLargas.body.message)).toContain('notas no puede superar 2000');
    });
  });

  // ───────────────────────── GET listado ─────────────────────────

  describe('GET /api/candidatos (listado paginado)', () => {
    it('filtra por cédula EXACTA vía hash (sin comparar texto plano)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/candidatos')
        .query({ cedula: CEDULA_PRINCIPAL })
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      // Encuentra al candidato correcto aunque en BD la cédula esté cifrada.
      expect(response.body.total).toBe(1);
      expect(response.body.items[0].id).toBe(candidatoPrincipal.id);
      expect(response.body.items[0].cedula).toBe(CEDULA_PRINCIPAL);
    });

    it('filtrar por una cédula INEXISTENTE devuelve 0 resultados', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/candidatos')
        .query({ cedula: '99999999' })
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(response.body.total).toBe(0);
      expect(response.body.items).toHaveLength(0);
    });

    it('filtra por nombre con ILIKE (parcial e insensible a mayúsculas)', async () => {
      // `q` = token único en minúsculas; debe coincidir con `TOKEN_Q` en
      // `nombres` aunque esté en otra capitalización.
      const response = await request(app.getHttpServer())
        .get('/api/candidatos')
        .query({ q: TOKEN_Q.toLowerCase() })
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(response.body.total).toBeGreaterThanOrEqual(1);
      expect(
        response.body.items.some((item: { id: string }) => item.id === candidatoPrincipal.id),
      ).toBe(true);
    });

    it('devuelve { items, total, page, limit } y pagina con limit=1', async () => {
      // `q` = SUFIJO_UNICO coincide con `apellidos` y `ciudad` de los 3 candidatos
      // de prueba (principal, Baltasar y el del bloque POST): comprueba la forma
      // paginada y que dos páginas no se solapan.
      const pagina1 = await request(app.getHttpServer())
        .get('/api/candidatos')
        .query({ q: SUFIJO_UNICO, limit: 1 })
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(pagina1.body).toMatchObject({ page: 1, limit: 1 });
      expect(pagina1.body.items).toHaveLength(1);

      const pagina2 = await request(app.getHttpServer())
        .get('/api/candidatos')
        .query({ q: SUFIJO_UNICO, limit: 1, page: 2 })
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      // Páginas distintas (sin solape) contienen filas distintas.
      expect(pagina2.body.items[0].id).not.toBe(pagina1.body.items[0].id);
    });

    it('rechaza limit > 100, page < 1 y cédula mal formada con 400', async () => {
      await request(app.getHttpServer())
        .get('/api/candidatos')
        .query({ limit: 101 })
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/candidatos')
        .query({ page: 0 })
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/candidatos')
        .query({ cedula: 'abc' })
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);
    });
  });

  // ───────────────────────── GET detalle ─────────────────────────

  describe('GET /api/candidatos/:id', () => {
    it('devuelve 200 con la PII DESCIFRADA', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/candidatos/${candidatoPrincipal.id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: candidatoPrincipal.id,
        cedula: CEDULA_PRINCIPAL,
        ciudad: MARCA,
      });
      expect(response.body).not.toHaveProperty('cedulaHash');
    });

    it('devuelve 404 con mensaje claro si el id no existe', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/candidatos/${randomUUID()}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(404);

      expect(response.body.message).toContain('No existe un candidato');
    });

    it('devuelve 400 si el id no es un uuid', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/candidatos/no-es-un-uuid')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);

      expect(response.body.message).toBe('El identificador del candidato debe ser un UUID válido');
    });
  });

  // ───────────────────────── PATCH ─────────────────────────

  describe('PATCH /api/candidatos/:id', () => {
    it('el CREADOR que cambia la cédula → 200 y RE-CIFRA (nuevo hash y cifrado)', async () => {
      // Localiza el candidato "Baltasar" (CEDULA_COLISION) para editar SU cédula.
      const filaAntes = (await repo.query(
        'SELECT id, cedula_cifrada, cedula_hash FROM candidatos WHERE cedula_hash = $1',
        [hmacDeCedula(CEDULA_COLISION)],
      )) as Array<{ id: string; cedula_cifrada: string; cedula_hash: string }>;
      const idBaltasar = filaAntes[0]?.id ?? '';
      expect(idBaltasar).not.toBe('');

      const response = await request(app.getHttpServer())
        .patch(`/api/candidatos/${idBaltasar}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ cedula: CEDULA_EDITADA, telefono: '3009998877', notas: 'Editado por el creador' })
        .expect(200);

      // Devuelve la cédula NUEVA en claro y el teléfono re-cifrado (descifrado).
      expect(response.body.cedula).toBe(CEDULA_EDITADA);
      expect(response.body.telefono).toBe('3009998877');
      expect(response.body.notas).toBe('Editado por el creador');

      // En BD: el cifrado y el hash se recalcularon (ya no coinciden con los de
      // CEDULA_COLISION, que era el valor anterior).
      const filaDespues = (await repo.query(
        'SELECT cedula_cifrada, cedula_hash FROM candidatos WHERE id = $1',
        [idBaltasar],
      )) as Array<{ cedula_cifrada: string; cedula_hash: string }>;
      const despues = filaDespues[0];
      const antes = filaAntes[0];
      expect(despues).toBeDefined();
      if (!despues || !antes) {
        return;
      }
      expect(despues.cedula_cifrada).not.toBe(antes.cedula_cifrada);
      expect(despues.cedula_hash).toBe(hmacDeCedula(CEDULA_EDITADA));
      expect(despues.cedula_hash).not.toBe(hmacDeCedula(CEDULA_COLISION));
    });

    it('otro analista (NO creador) → 403', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/candidatos/${candidatoPrincipal.id}`)
        .set('Authorization', `Bearer ${tokenAnalistaOtro}`)
        .send({ notas: 'Intento ajeno' })
        .expect(403);

      expect(response.body.message).toBe(
        'Solo el creador del candidato o un administrador de RRHH pueden modificarlo',
      );
    });

    it('admin_rrhh NO creador → 200 (puede editar)', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/candidatos/${candidatoPrincipal.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ notas: 'Editado por administración' })
        .expect(200);

      expect(response.body.notas).toBe('Editado por administración');
      expect(response.body.createdBy).toBe(creadorId); // la autoría no cambia
    });

    it('al cambiar la cédula por la de OTRO candidato → 409 (colisión)', async () => {
      // CEDULA_EDITADA ya pertenece a "Baltasar" tras el primer PATCH: asignársela
      // al candidato principal debe chocar con el índice único de `cedula_hash`.
      const response = await request(app.getHttpServer())
        .patch(`/api/candidatos/${candidatoPrincipal.id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ cedula: CEDULA_EDITADA })
        .expect(409);

      expect(response.body.message).toBe('Ya existe otro candidato con esa cédula');
    });

    it('devuelve 404 si el candidato no existe', async () => {
      await request(app.getHttpServer())
        .patch(`/api/candidatos/${randomUUID()}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ notas: 'Fantasma' })
        .expect(404);
    });
  });

  // ───────────────────────── DELETE (corrección posterior a la Etapa 9) ─────────────────────────

  describe('DELETE /api/candidatos/:id (borrado por error de captura)', () => {
    it('otro analista (NO creador) → 403 con mensaje claro', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/api/candidatos/${candidatoPrincipal.id}`)
        .set('Authorization', `Bearer ${tokenAnalistaOtro}`)
        .expect(403);

      expect(response.body.message).toBe(
        'Solo el creador del candidato o el superusuario (IT) pueden eliminarlo',
      );

      // La fila NO se tocó.
      const filas = (await repo.query('SELECT id FROM candidatos WHERE id = $1', [
        candidatoPrincipal.id,
      ])) as Array<{ id: string }>;
      expect(filas).toHaveLength(1);
    });

    it('admin_rrhh NO creador → 403 (a diferencia de editar, NO borra ajenos)', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/api/candidatos/${candidatoPrincipal.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(403);

      expect(response.body.message).toBe(
        'Solo el creador del candidato o el superusuario (IT) pueden eliminarlo',
      );
    });

    it('el CREADOR → 204, borra la fila y deja el DELETE en audit_log con el actor', async () => {
      const fixture = await crearFixture('Borrable', CEDULA_BORRABLE, TOKEN_Q);

      await request(app.getHttpServer())
        .delete(`/api/candidatos/${fixture.id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(204);

      // La fila desapareció de `candidatos`.
      const filas = (await repo.query('SELECT id FROM candidatos WHERE id = $1', [
        fixture.id,
      ])) as Array<{ id: string }>;
      expect(filas).toHaveLength(0);

      // El trigger `candidatos_audit_log` (DELETE desde la 011) dejó la entrada
      // con changed_by = quién ejecutó el borrado (el GUC del servicio).
      const auditoria = (await repo.query(
        `SELECT action, changed_by, old_data, new_data
           FROM audit_log
          WHERE table_name = 'candidatos' AND record_id = $1 AND action = 'DELETE'`,
        [fixture.id],
      )) as Array<{
        action: string;
        changed_by: string | null;
        old_data: Record<string, unknown> | null;
        new_data: Record<string, unknown> | null;
      }>;
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.changed_by).toBe(creadorId);
      expect(auditoria[0]?.old_data).not.toBeNull();
      expect(auditoria[0]?.new_data).toBeNull();
    });

    it('el superusuario (IT) → 204 sobre un candidato AJENO', async () => {
      const fixture = await crearFixture('BorrableIT', CEDULA_BORRABLE_IT, TOKEN_Q);

      await request(app.getHttpServer())
        .delete(`/api/candidatos/${fixture.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(204);

      const filas = (await repo.query('SELECT id FROM candidatos WHERE id = $1', [
        fixture.id,
      ])) as Array<{ id: string }>;
      expect(filas).toHaveLength(0);
    });

    it('con POSTULACIÓN (ligado a un requerimiento) → 409 y la fila se conserva', async () => {
      const fixture = await crearFixture('BorrableLigada', CEDULA_LIGADA, TOKEN_Q);

      // Requerimiento + postulación por SQL crudo: el escenario es «está ligado»,
      // no probar el flujo de postulaciones (eso tiene su propio e2e).
      const codigoReq = `REQ-2026-${randomInt(100000, 999999)}`;
      const requerimientos = (await repo.query(
        `INSERT INTO requerimientos
            (code, created_by, titulo, jefatura, numero_plazas, perfil_profesional,
             experiencia_requerida, nivel_educacion, conocimientos, habilidades,
             salario_min, salario_max, tipo_contrato, jornada, departamento_id,
             ubicacion, fecha_requerida, justificacion, modalidad, urgencia)
          VALUES ($1, $2, 'Requerimiento de prueba DELETE', 'Talento Humano', 1,
                  'Perfil de prueba', '2 años', 'Profesional', ARRAY['SQL'], ARRAY['Análisis'],
                  2800000, 3500000, 'Indefinido', 'Diurna', (SELECT id FROM departamentos LIMIT 1),
                  'Bogotá D.C.', '2026-12-01', 'Justificación de prueba', 'directa', 'normal')
         RETURNING id`,
        [codigoReq, creadorId],
      )) as Array<{ id: string }>;
      const requerimientoId = requerimientos[0]?.id ?? '';
      expect(requerimientoId).not.toBe('');

      await repo.query(
        `INSERT INTO postulaciones (candidato_id, requerimiento_id, created_by)
         VALUES ($1, $2, $3)`,
        [fixture.id, requerimientoId, creadorId],
      );

      try {
        const response = await request(app.getHttpServer())
          .delete(`/api/candidatos/${fixture.id}`)
          .set('Authorization', `Bearer ${tokenAnalista}`)
          .expect(409);

        expect(response.body.message).toBe(
          'No se puede eliminar: el candidato está ligado a un requerimiento',
        );

        // El candidato y su postulación siguen intactos.
        const candidatos = (await repo.query('SELECT id FROM candidatos WHERE id = $1', [
          fixture.id,
        ])) as Array<{ id: string }>;
        expect(candidatos).toHaveLength(1);
        const postulaciones = (await repo.query(
          'SELECT id FROM postulaciones WHERE candidato_id = $1',
          [fixture.id],
        )) as Array<{ id: string }>;
        expect(postulaciones).toHaveLength(1);
      } finally {
        // Limpieza: el requerimiento se borra y la postulación cae en cascada.
        await repo.query('DELETE FROM requerimientos WHERE id = $1', [requerimientoId]);
      }
    });

    it('sin token → 401; id inexistente → 404', async () => {
      await request(app.getHttpServer()).delete(`/api/candidatos/${randomUUID()}`).expect(401);

      await request(app.getHttpServer())
        .delete(`/api/candidatos/${randomUUID()}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(404);
    });
  });

  // ───────────────────────── regresiones (ping + auth) ─────────────────────────

  it('GET /api/candidatos/ping sigue respondiendo el placeholder', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/candidatos/ping')
      .set('Authorization', `Bearer ${tokenAnalista}`)
      .expect(200);

    expect(response.body).toEqual({ modulo: 'candidatos', status: 'placeholder' });
  });

  it('sin token → 401 en todos los endpoints del módulo', async () => {
    await request(app.getHttpServer()).get('/api/candidatos').expect(401);
    await request(app.getHttpServer()).get(`/api/candidatos/${randomUUID()}`).expect(401);
    await request(app.getHttpServer()).post('/api/candidatos').expect(401);
    await request(app.getHttpServer()).patch(`/api/candidatos/${randomUUID()}`).expect(401);
  });
});
