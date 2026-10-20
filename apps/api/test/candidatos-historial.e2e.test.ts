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
import type { EntradaHistorialDto } from '../src/modules/candidatos/candidatos.service';

/**
 * Candidatos — Fase 4, parte 3: `GET /api/candidatos/:id/historial`, la vista
 * del HISTORIAL de cambios leída de `audit_log` (BD dev docker REAL).
 *
 * ⚠ Igual que `candidatos-crud.e2e.test.ts`, este test usa la base de datos de
 * desarrollo (`DATABASE_URL` del `.env` raíz → localhost:5432/ats_dev). Motivo:
 * lo que se verifica ES de PostgreSQL y de la capa TypeORM real — el trigger
 * `audit_fila()` (migraciones 003/004) escribiendo `audit_log`, los jsonb
 * `old_data`/`new_data`, la FK `changed_by` y el orden temporal—; falsear la
 * consulta demostraría exactamente nada.
 *
 * ACCESO A LA BD: el `DataSource` LAZY del módulo de candidatos vía
 * `CandidatosStoreService.repo()`, NUNCA `app.get(DataSource)` (ambiguo cuando
 * dos módulos registran el suyo propio). Tokens JWT firmados con el
 * `JwtService` global; los `sub` son UUIDs de usuarios REALES creados en
 * `beforeAll` y borrados en `afterAll` (FK `created_by` → `users(id)`).
 *
 * AISLAMIENTO: todos los candidatos de prueba llevan un sufijo único por
 * ejecución en `apellidos` (la marca de limpieza; NO se usa `ciudad` aquí
 * porque el guion la MODIFICA con un PATCH). `audit_log` NO se limpia: es
 * INMUTABLE por diseño. Para poder borrar los usuarios de prueba (la FK
 * `audit_log.changed_by` haría `SET NULL`, que el trigger de inmutabilidad
 * rechazaría) la transacción deshabilita y re-habilita ese trigger (patrón del
 * `down` de la migración 002 y del resto de e2e que tocan la BD dev).
 */

const ADMIN_EMAIL = 'admin@larco.co';

/** Hash de mentira: estos usuarios jamás inician sesión (solo aportan un id). */
const PASSWORD_HASH_FICTICIO = 'no-utilizable-en-tests';

/** Usuarios de prueba (creados y borrados por ESTE test). */
const USUARIOS_DE_PRUEBA = [
  {
    email: 'cand-hist-analista@larco.test',
    fullName: 'Test Hist Analista',
    role: 'analista_seleccion',
  },
  { email: 'cand-hist-lider@larco.test', fullName: 'Test Hist Lider', role: 'lider_area' },
] as const;

const EMAIL_ANALISTA = USUARIOS_DE_PRUEBA[0].email;

/** Sufijo único por ejecución: aísla las filas de prueba del resto de la BD dev. */
const SUFIJO_UNICO = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

/**
 * Marca de limpieza en `apellidos` (NO en `ciudad`: el guion la cambia con un
 * PATCH, así que limpiar por la ciudad inicial dejaría huérfanos).
 */
const APELLIDOS_MARCA = `HistPrueba ${SUFIJO_UNICO}`;

/** Ciudad inicial (la del INSERT) y ciudad nueva (la del PATCH/UPDATE). */
const CIUDAD_ORIGINAL = `Ciudad-Origin-${SUFIJO_UNICO}`;
const CIUDAD_NUEVA = `Ciudad-Editada-${SUFIJO_UNICO}`;

/** Teléfono de prueba (PII que debe salir ENMASCARADA en el historial). */
const TELEFONO = '3005551234';

/**
 * Cédula única por ejecución (9 dígitos): derivada del timestamp para no
 * chocar con datos reales de la BD dev. Es la PII que debe aparecer como
 * `'***'` —nunca en claro ni cifrada— en el historial.
 */
const CEDULA = `${randomInt(1000000, 10000000).toString()}55`;

/**
 * HMAC-SHA-256 (hex) de la cédula con la llave REAL del entorno: oráculo
 * independiente para comprobar que el hash NUNCA aparece en la respuesta del
 * historial (misma receta que `candidatos-crud.e2e.test.ts`).
 */
function hmacDeCedula(cedula: string): string {
  const llave = process.env.CEDULA_SEARCH_KEY;
  if (!llave) {
    throw new Error('Falta CEDULA_SEARCH_KEY en el entorno (test-env la fija)');
  }
  return createHmac('sha256', Buffer.from(llave, 'base64')).update(cedula, 'utf8').digest('hex');
}

describe('Candidatos — historial de audit_log e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let appInicializado = false;
  let jwt: JwtService;

  // Repo LAZY del módulo de candidatos: SQL crudo y transacciones SIN depender
  // de la resolución ambigua de `app.get(DataSource)`.
  let repo: Repository<Candidato>;
  let store: CandidatosStoreService;

  let creadorId: string;
  let tokenAnalista: string;
  let tokenLider: string;

  /** Candidato del guion: se crea en beforeAll (INSERT) y se edita (UPDATE). */
  let candidato: { id: string };

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
    // inicializa de forma perezosa al primer uso.
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
    repo = await store.repo();

    // El admin del seed 002 (referencia de la BD dev; este test no lo usa en
    // tokens, pero su presencia confirma que las migraciones están aplicadas).
    const admins = (await repo.query('SELECT id FROM users WHERE email = $1', [
      ADMIN_EMAIL,
    ])) as Array<{ id: string }>;
    if (admins[0]?.id === undefined) {
      throw new Error(
        `No se encontró el usuario ${ADMIN_EMAIL}: ejecuta las migraciones (pnpm --filter @ats/api db:migrate)`,
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
    tokenAnalista = jwt.sign({
      sub: creadorId,
      email: EMAIL_ANALISTA,
      role: 'analista_seleccion',
    });
    tokenLider = jwt.sign({
      sub: idDe(USUARIOS_DE_PRUEBA[1].email),
      email: USUARIOS_DE_PRUEBA[1].email,
      role: 'lider_area',
    });

    // Fixture: el candidato cuyo historial se examina. El INSERT del POST genera
    // la PRIMERA entrada de `audit_log` (atribuida a created_by: sin GUC).
    const response = await request(app.getHttpServer())
      .post('/api/candidatos')
      .set('Authorization', `Bearer ${tokenAnalista}`)
      .send({
        nombres: 'Candidato Historial',
        apellidos: APELLIDOS_MARCA,
        email: `historial-${SUFIJO_UNICO}@mail.test`,
        cedula: CEDULA,
        telefono: TELEFONO,
        ciudad: CIUDAD_ORIGINAL,
        cargoActual: 'Ingeniero de Datos',
        expectativaSalarial: 4_500_000,
      })
      .expect(201);
    candidato = { id: response.body.id as string };
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
        // Los candidatos de prueba se marcan por `apellidos` (no lo toca ningún PATCH).
        await em.query('DELETE FROM candidatos WHERE apellidos = $1', [APELLIDOS_MARCA]);
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

  // ───────────────────────── historial ─────────────────────────

  describe('GET /api/candidatos/:id/historial', () => {
    it('tras el PATCH de la ciudad: INSERT + UPDATE ordenados created_at DESC y el diff de ciudad', async () => {
      // El CREADOR cambia la ciudad → el trigger `audit_fila()` registra el
      // UPDATE con `changed_by` = sub del JWT (GUC fijado en la transacción).
      await request(app.getHttpServer())
        .patch(`/api/candidatos/${candidato.id}`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({ ciudad: CIUDAD_NUEVA })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/api/candidatos/${candidato.id}/historial`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      const entradas = response.body as EntradaHistorialDto[];

      // Este candidato solo ha tenido DOS escrituras: el alta y este PATCH.
      expect(entradas).toHaveLength(2);
      const [entradaUpdate, entradaAlta] = entradas;
      // Orden DESC: el cambio más reciente (UPDATE) encima; el alta (INSERT) debajo.
      expect(entradaUpdate?.accion).toBe('UPDATE');
      expect(entradaAlta?.accion).toBe('INSERT');

      // El actor de AMBAS entradas es el creador (INSERT vía created_by,
      // UPDATE vía el GUC app.current_user_id) y trae uuid crudo + email.
      for (const entrada of entradas) {
        expect(typeof entrada.id).toBe('string');
        expect(entrada.usuario).toBe(creadorId);
        expect(entrada.usuarioEmail).toBe(EMAIL_ANALISTA);
        // `fecha` es ISO 8601 estricto (round-trip estable).
        expect(new Date(entrada.fecha).toISOString()).toBe(entrada.fecha);
      }

      // El UPDATE lista SOLO el campo que cambió (los intactos no aparecen).
      expect(entradaUpdate?.campos).toEqual([
        { campo: 'ciudad', antes: CIUDAD_ORIGINAL, despues: CIUDAD_NUEVA },
      ]);

      // El INSERT informa el alta con `antes: null`.
      expect(entradaAlta?.campos).toEqual(
        expect.arrayContaining([
          { campo: 'ciudad', antes: null, despues: CIUDAD_ORIGINAL },
          { campo: 'cargoActual', antes: null, despues: 'Ingeniero de Datos' },
        ]),
      );
    });

    it('enmascara la PII (***): ni hash, ni cifrado, ni texto plano en NINGUNA parte de la respuesta', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/candidatos/${candidato.id}/historial`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      const texto = JSON.stringify(response.body);

      // El hash HMAC de la cédula (oráculo calculado AQUÍ) no aparece NINGUNA parte.
      expect(texto).not.toContain(hmacDeCedula(CEDULA));
      // Ni el texto plano de la PII…
      expect(texto).not.toContain(CEDULA);
      expect(texto).not.toContain(TELEFONO);
      // …ni las columnas CIFRADAS tal y como están guardadas en BD.
      const filas = (await repo.query(
        'SELECT cedula_cifrada, telefono_cifrada FROM candidatos WHERE id = $1',
        [candidato.id],
      )) as Array<{ cedula_cifrada: string; telefono_cifrada: string }>;
      expect(filas[0]?.cedula_cifrada.startsWith('v1:')).toBe(true);
      expect(texto).not.toContain(filas[0]?.cedula_cifrada ?? 'cedula-ausente');
      expect(texto).not.toContain(filas[0]?.telefono_cifrada ?? 'telefono-ausente');
      // Y ninguna clave interna se cuela en los nombres de campo.
      expect(texto).not.toMatch(/cedulaHash|cedula_hash|Cifrada|cifrada/);

      // En cambio, el alta SÍ informa que la PII existía, pero ENMASCARADA.
      const entradas = response.body as EntradaHistorialDto[];
      const alta = entradas.find((entrada) => entrada.accion === 'INSERT');
      expect(alta?.campos).toEqual(
        expect.arrayContaining([
          { campo: 'cedula', antes: null, despues: '***' },
          { campo: 'telefono', antes: null, despues: '***' },
        ]),
      );
    });

    it('devuelve 400 si el id no es un uuid (mismo mensaje que el detalle)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/candidatos/no-es-un-uuid/historial')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);

      expect(response.body.message).toBe('El identificador del candidato debe ser un UUID válido');
    });

    it('devuelve 404 con mensaje claro si el candidato no existe (aunque el id sea uuid válido)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/candidatos/${randomUUID()}/historial`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(404);

      expect(response.body.message).toContain('No existe un candidato');
    });

    it('devuelve 200 para cualquier rol autenticado (lider_area)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/candidatos/${candidato.id}/historial`)
        .set('Authorization', `Bearer ${tokenLider}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect((response.body as EntradaHistorialDto[])[0]?.accion).toBe('UPDATE');
    });

    it('sin token → 401', async () => {
      await request(app.getHttpServer())
        .get(`/api/candidatos/${candidato.id}/historial`)
        .expect(401);
    });
  });
});
