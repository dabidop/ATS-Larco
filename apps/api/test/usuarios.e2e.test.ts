/**
 * E2E del módulo de gestión de usuarios (`/api/usuarios`) — Etapa 8B.
 *
 * ⚠ Usa la BD DEV REAL de docker (`DATABASE_URL` del `.env` raíz): lo que se
 * verifica ES de PostgreSQL — el hash scrypt real, el índice único
 * `users_email_key` (23505 → 409) y el invariante del "último superusuario
 * activo" contado con SQL sobre el estado REAL. Falsear el pool no demostraría
 * nada.
 *
 * Aislamiento:
 *  - Tokens JWT firmados con el `JwtService` global (mismo `JWT_SECRET`); el
 *    `sub` es un UUID REAL (FK `audit_log.changed_by` → `users(id)`).
 *  - El superusuario bajo prueba es `it@larco.co` (migración 008): el ÚNICO
 *    superusuario activo de la BD dev, que es exactamente el estado que exige
 *    el invariante de "último superusuario".
 *  - Los demás usuarios se CREAN en `beforeAll` (emails `e2e-usuarios-*`) y se
 *    BORRAN en `afterAll` dentro de UNA transacción que deshabilita
 *    `audit_log_no_mutation` (patrón de `postulaciones.e2e.test.ts`): borrar
 *    usuarios dispara un UPDATE de `audit_log.changed_by` (FK ON DELETE SET
 *    NULL) que ese trigger rechaza.
 *
 * El guard es STATELESS (lee el claim `role` del JWT, sin consultar la BD),
 * así que "actuar como superusuario" es cuestión del claim del token; el
 * servicio en cambio decide sobre el ESTADO REAL de la BD.
 */
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
import { verifyPassword } from '../src/common/crypto/password.util';

/** Superusuario real del sistema (migración 008). */
const EMAIL_SUPERUSUARIO = 'it@larco.co';
/** Admin RRHH real del seed 002 (también sirve de "actor" ajeno). */
const EMAIL_ADMIN = 'admin@larco.co';

/** Cédulas únicas por ejecución: evitan el 409 de `candidatos_cedula_hash_unique`. */
const CEDULA_BASE = randomInt(1000000, 10000000).toString();
const CEDULA_SU = `${CEDULA_BASE}88`;

describe('Gestión de usuarios — módulo exclusivo del superusuario (BD dev real)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let jwt: JwtService;

  /** UUID real del único superusuario activo (`it@larco.co`). */
  let superusuarioId: string;
  let adminId: string;
  let analistaId: string;
  let liderId: string;

  let tokenSuper: string;
  /** Token con claim `role: superusuario` emitido para el ADMIN (actor ajeno). */
  let tokenSuperAjeno: string;
  let tokenAdmin: string;
  let tokenLider: string;
  let tokenAnalista: string;

  const PASSWORD = 'ClaveSegura1';

  /** Consulta directa al pool (mismo acceso que el módulo). */
  function query<T extends Record<string, unknown>>(text: string, params: unknown[] = []) {
    return database.query<T>(text, params);
  }

  /** Crea un usuario de prueba y devuelve su `id` (hash ficticio: no loguea). */
  async function seedUsuario(email: string, rol: string, nombre: string): Promise<string> {
    const resultado = await query<{ id: string }>(
      `INSERT INTO users (role_id, email, password_hash, full_name, active)
       SELECT r.id, $1, $2, $3, true FROM roles r WHERE r.code = $4
       RETURNING id`,
      [email, 'x'.repeat(60), nombre, rol],
    );
    const id = resultado.rows[0]?.id;
    if (id === undefined) {
      throw new Error(`No se pudo crear el usuario de prueba ${email} (¿falta la migración 002?)`);
    }
    return id;
  }

  /** Superusuarios activos EXCLUYENDO una fila (es decir, "los otros"). */
  async function otrosSuperusuariosActivos(excluidoId: string): Promise<number> {
    const r = await query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.code = 'superusuario' AND u.active AND u.id <> $1`,
      [excluidoId],
    );
    return r.rows[0]?.total ?? 0;
  }

  beforeAll(async () => {
    // AppModule REAL, sin overrides: scrypt, el GUC de auditoría y el
    // ValidationPipe réplica del de `src/main.ts` son los de producción.
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    jwt = app.get(JwtService);
    database = app.get(DatabaseService, { strict: false });

    const usuarios = await query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE email = ANY($1::text[])',
      [[EMAIL_SUPERUSUARIO, EMAIL_ADMIN]],
    );
    const idDe = (email: string): string => {
      const id = usuarios.rows.find((fila) => fila.email === email)?.id;
      if (id === undefined) {
        throw new Error(
          `No se encontró ${email}: ejecuta las migraciones (pnpm --filter @ats/api db:migrate)`,
        );
      }
      return id;
    };
    superusuarioId = idDe(EMAIL_SUPERUSUARIO);
    adminId = idDe(EMAIL_ADMIN);

    analistaId = await seedUsuario(
      'e2e-usuarios-analista@larco.co',
      'analista_seleccion',
      'E2E Usuarios Analista',
    );
    liderId = await seedUsuario('e2e-usuarios-lider@larco.co', 'lider_area', 'E2E Usuarios Lider');

    tokenSuper = await jwt.signAsync({ sub: superusuarioId, email: EMAIL_SUPERUSUARIO, role: 'superusuario' });
    // Actor AJENO al superusuario bajo prueba: el guard solo lee el claim, y
    // el servicio compara `sub` — así se ejercitan las reglas de "propio".
    tokenSuperAjeno = await jwt.signAsync({ sub: adminId, email: EMAIL_ADMIN, role: 'superusuario' });
    tokenAdmin = await jwt.signAsync({ sub: adminId, email: EMAIL_ADMIN, role: 'admin_rrhh' });
    tokenLider = await jwt.signAsync({ sub: liderId, email: 'e2e-usuarios-lider@larco.co', role: 'lider_area' });
    tokenAnalista = await jwt.signAsync({
      sub: analistaId,
      email: 'e2e-usuarios-analista@larco.co',
      role: 'analista_seleccion',
    });
  });

  afterAll(async () => {
    if (database === undefined) {
      return;
    }

    // Limpieza atómica: si algo falla, el roll-back deja la BD dev como estaba.
    const cliente = await database.pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(`DELETE FROM candidatos WHERE email = $1`, [
        `e2e-usuarios-candidato@larco.co`,
      ]);
      // `audit_log.changed_by` es FK con ON DELETE SET NULL: borrar usuarios
      // provocaría un UPDATE sobre `audit_log`, que su trigger de inmutabilidad
      // rechaza. Se deshabilita SOLO dentro de esta transacción. Las filas de
      // `audit_log` se CONSERVAN (inmutables por diseño).
      await cliente.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutation');
      await cliente.query(`DELETE FROM users WHERE email LIKE 'e2e-usuarios-%'`);
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

  // ───────────────────────── POST /api/usuarios ─────────────────────────

  describe('POST /api/usuarios — alta (201)', () => {
    it('crea el usuario, hashea la contraseña con scrypt y normaliza el email', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({
          nombre: 'Usuario Nuevo',
          email: 'E2E-USUARIOS-NUEVO@Larco.CO', // en mayúsculas: debe normalizarse
          password: PASSWORD,
          rol: 'analista_seleccion',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        nombre: 'Usuario Nuevo',
        email: 'e2e-usuarios-nuevo@larco.co', // en minúsculas
        rol: 'analista_seleccion',
        rolNombre: 'Analista de Selección',
        activo: true,
      });
      expect(typeof response.body.id).toBe('string');
      expect(typeof response.body.creadoEn).toBe('string');
      // La respuesta NUNCA trae el hash ni ningún control interno.
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('password_hash');
      expect(response.body).not.toHaveProperty('roleId');

      // En BD: hash scrypt REAL (verificable con la misma utilidad) y la
      // contraseña NUNCA en claro.
      const enBd = await query<{ password_hash: string; active: boolean }>(
        'SELECT password_hash, active FROM users WHERE id = $1',
        [response.body.id],
      );
      const hash = enBd.rows[0]?.password_hash ?? '';
      expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
      expect(await verifyPassword(PASSWORD, hash)).toBe(true);
      expect(await verifyPassword('otra-clave', hash)).toBe(false);
      expect(hash).not.toContain(PASSWORD);
      expect(enBd.rows[0]?.active).toBe(true);
    });

    it('acepta un password de 100 caracteres y también lo hashea', async () => {
      const largo = 'A1'.repeat(50); // 100 caracteres
      const response = await request(app.getHttpServer())
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({
          nombre: 'Password Largo',
          email: 'e2e-usuarios-largo@larco.co',
          password: largo,
          rol: 'lider_area',
        })
        .expect(201);

      const enBd = await query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [response.body.id],
      );
      const hash = enBd.rows[0]?.password_hash ?? '';
      expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
      expect(await verifyPassword(largo, hash)).toBe(true);
      expect(hash).not.toContain(largo);
    });

    it('409 «Ya existe un usuario con ese correo» si el email ya está registrado', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({
          nombre: 'Duplicado',
          email: EMAIL_ADMIN,
          password: PASSWORD,
          rol: 'analista_seleccion',
        })
        .expect(409);

      expect(response.body.message).toBe('Ya existe un usuario con ese correo');
    });

    it('409 también si el email coincide SOLO en mayúsculas (normalización)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({
          nombre: 'Duplicado Mayúsculas',
          email: 'ADMIN@LARCO.CO',
          password: PASSWORD,
          rol: 'analista_seleccion',
        })
        .expect(409);

      expect(response.body.message).toBe('Ya existe un usuario con ese correo');
    });

    it('400 «password debe tener al menos 8 caracteres» si el password es corto', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({
          nombre: 'Password Corto',
          email: 'e2e-usuarios-corto@larco.co',
          password: '1234567',
          rol: 'analista_seleccion',
        })
        .expect(400);

      expect(response.body.message).toContain('password debe tener al menos 8 caracteres');
    });

    it('400 con el mensaje exacto de rol inválido', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({
          nombre: 'Rol Inválido',
          email: 'e2e-usuarios-rolinvalido@larco.co',
          password: PASSWORD,
          rol: 'robot',
        })
        .expect(400);

      expect(response.body.message).toContain(
        'rol debe ser uno de: admin_rrhh, analista_seleccion, lider_area, superusuario',
      );
    });

    it('400 si falta password (además de los campos obligatorios)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ nombre: 'Sin Password', email: 'e2e-usuarios-sinpassword@larco.co', rol: 'lider_area' })
        .expect(400);

      expect(response.body.message).toContain('password debe tener al menos 8 caracteres');
    });

    it('403 para admin_rrhh (RRHH NO gestiona cuentas) y 401 sin token', async () => {
      const conAdmin = await request(app.getHttpServer())
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          nombre: 'Intento Admin',
          email: 'e2e-usuarios-intento-admin@larco.co',
          password: PASSWORD,
          rol: 'analista_seleccion',
        })
        .expect(403);

      expect(conAdmin.body.message).toBe('No tienes permiso para realizar esta acción');

      await request(app.getHttpServer())
        .post('/api/usuarios')
        .send({
          nombre: 'Sin Token',
          email: 'e2e-usuarios-sintoken@larco.co',
          password: PASSWORD,
          rol: 'analista_seleccion',
        })
        .expect(401);
    });
  });

  // ───────────────────────── GET /api/usuarios ─────────────────────────

  describe('GET /api/usuarios — listado paginado', () => {
    it('devuelve { items, total, page, limit } con defaults y SIN password_hash', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/usuarios')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(200);

      expect(Array.isArray(response.body.items)).toBe(true);
      // 4 fijos en esta BD dev: admin + superusuario + analista + lider (+ altas de este archivo).
      expect(response.body.total).toBeGreaterThanOrEqual(4);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(20);

      for (const usuario of response.body.items) {
        expect(usuario).not.toHaveProperty('passwordHash');
        expect(usuario).not.toHaveProperty('password_hash');
        expect(typeof usuario.id).toBe('string');
        expect(typeof usuario.email).toBe('string');
        expect(typeof usuario.rol).toBe('string');
        expect(typeof usuario.rolNombre).toBe('string');
        expect(typeof usuario.activo).toBe('boolean');
      }
    });

    it('filtra por `q` (ILIKE sobre nombre y email) y pagina con limit=2', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/usuarios?q=e2e-usuarios-&limit=2&page=1')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(200);

      expect(response.body.limit).toBe(2);
      expect(response.body.page).toBe(1);
      expect(response.body.items.length).toBeLessThanOrEqual(2);
      for (const usuario of response.body.items) {
        expect(usuario.email).toContain('e2e-usuarios-');
      }
      // El total es el de TODA la filtro, no el de la página servida.
      expect(response.body.total).toBeGreaterThanOrEqual(response.body.items.length);
    });

    it('filtra por `rol=superusuario` (devuelve al IT, el único activo)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/usuarios?rol=superusuario')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({
        email: EMAIL_SUPERUSUARIO,
        rol: 'superusuario',
        activo: true,
      });
    });

    it('400 si limit > 100 o page < 1', async () => {
      const limite = await request(app.getHttpServer())
        .get('/api/usuarios?limit=101')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(400);
      expect(limite.body.message).toContain('limit no puede superar 100');

      await request(app.getHttpServer())
        .get('/api/usuarios?page=0')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(400);
    });

    it('403 para admin_rrhh y 401 sin token', async () => {
      await request(app.getHttpServer()).get('/api/usuarios').set('Authorization', `Bearer ${tokenAdmin}`).expect(403);
      await request(app.getHttpServer()).get('/api/usuarios').expect(401);
    });
  });

  // ───────────────────────── GET /api/usuarios/:id ─────────────────────────

  describe('GET /api/usuarios/:id — detalle', () => {
    it('devuelve el usuario SIN password_hash', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/usuarios/${superusuarioId}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: superusuarioId,
        email: EMAIL_SUPERUSUARIO,
        rol: 'superusuario',
        activo: true,
      });
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('password_hash');
    });

    it('404 si no existe y 400 si el id no es un UUID', async () => {
      const respuesta404 = await request(app.getHttpServer())
        .get('/api/usuarios/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(404);
      expect(respuesta404.body.message).toContain('No existe un usuario con id');

      await request(app.getHttpServer())
        .get('/api/usuarios/no-es-uuid')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(400);
    });

    it('403 para admin_rrhh', async () => {
      await request(app.getHttpServer())
        .get(`/api/usuarios/${superusuarioId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(403);
    });
  });

  // ───────────────────────── PATCH /api/usuarios/:id ─────────────────────────

  describe('PATCH /api/usuarios/:id — actualización parcial', () => {
    it('desactiva y reactiva un usuario (activo)', async () => {
      const desactivado = await request(app.getHttpServer())
        .patch(`/api/usuarios/${analistaId}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ activo: false })
        .expect(200);
      expect(desactivado.body.activo).toBe(false);

      const enBd = await query<{ active: boolean }>('SELECT active FROM users WHERE id = $1', [analistaId]);
      expect(enBd.rows[0]?.active).toBe(false);

      const reactivado = await request(app.getHttpServer())
        .patch(`/api/usuarios/${analistaId}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ activo: true })
        .expect(200);
      expect(reactivado.body.activo).toBe(true);
    });

    it('cambia el rol y refleja el nuevo rolNombre', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/usuarios/${liderId}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ rol: 'analista_seleccion' })
        .expect(200);

      expect(response.body.rol).toBe('analista_seleccion');
      expect(response.body.rolNombre).toBe('Analista de Selección');

      // Se restaura para el resto del archivo.
      await request(app.getHttpServer())
        .patch(`/api/usuarios/${liderId}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ rol: 'lider_area' })
        .expect(200);
    });

    it('cambia el password (scrypt en BD, jamás en la respuesta)', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/usuarios/${liderId}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ password: 'NuevaClave1' })
        .expect(200);

      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('password_hash');

      const enBd = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [liderId]);
      const hash = enBd.rows[0]?.password_hash ?? '';
      expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
      expect(await verifyPassword('NuevaClave1', hash)).toBe(true);
      expect(hash).not.toContain('NuevaClave1');
    });

    it('400 «Debe indicar al menos un cambio (activo, rol o password)» si el cuerpo va vacío', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/usuarios/${analistaId}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({})
        .expect(400);

      expect(response.body.message).toContain('Debe indicar al menos un cambio (activo, rol o password)');
    });

    it('409 «No puede desactivar su propia cuenta» si el superusuario se desactiva a sí mismo', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/usuarios/${superusuarioId}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ activo: false })
        .expect(409);

      expect(response.body.message).toBe('No puede desactivar su propia cuenta');
    });

    it('409 «No puede cambiar su propio rol» si el superusuario se cambia de rol a sí mismo', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/usuarios/${superusuarioId}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ rol: 'admin_rrhh' })
        .expect(409);

      expect(response.body.message).toBe('No puede cambiar su propio rol');
    });

    it('409 «Debe permanecer al menos un superusuario activo» al desactivar al ÚLTIMO superusuario', async () => {
      // `superusuarioId` (it@larco.co) es el ÚNICO superusuario activo; lo
      // ataca un actor AJENO (por eso no salta la regla de auto-desactivación).
      expect(await otrosSuperusuariosActivos(superusuarioId)).toBe(0);

      const response = await request(app.getHttpServer())
        .patch(`/api/usuarios/${superusuarioId}`)
        .set('Authorization', `Bearer ${tokenSuperAjeno}`)
        .send({ activo: false })
        .expect(409);

      expect(response.body.message).toBe('Debe permanecer al menos un superusuario activo');

      // La regla se verifica ANTES de escribir: la cuenta sigue intacta.
      const enBd = await query<{ active: boolean }>('SELECT active FROM users WHERE id = $1', [superusuarioId]);
      expect(enBd.rows[0]?.active).toBe(true);
    });

    it('409 «Debe permanecer al menos un superusuario activo» al quitarle el ROL al último superusuario', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/usuarios/${superusuarioId}`)
        .set('Authorization', `Bearer ${tokenSuperAjeno}`)
        .send({ rol: 'admin_rrhh' })
        .expect(409);

      expect(response.body.message).toBe('Debe permanecer al menos un superusuario activo');

      const enBd = await query<{ role_id: string }>(
        `SELECT u.role_id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND r.code = 'superusuario'`,
        [superusuarioId],
      );
      expect(enBd.rowCount).toBe(1);
    });

    it('404 si el id no existe; 403 para admin_rrhh', async () => {
      await request(app.getHttpServer())
        .patch('/api/usuarios/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ activo: false })
        .expect(404);

      const conAdmin = await request(app.getHttpServer())
        .patch(`/api/usuarios/${analistaId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activo: false })
        .expect(403);
      expect(conAdmin.body.message).toBe('No tienes permiso para realizar esta acción');
    });
  });

  // ─────────────────── herencia de poderes de admin_rrhh ───────────────────

  describe('Herencia: superusuario = admin_rrhh + gestión de usuarios', () => {
    it('pasa el RBAC de los pings restringidos a admin_rrhh (requerimientos e importación)', async () => {
      const requerimientos = await request(app.getHttpServer())
        .get('/api/requerimientos/ping')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(200);
      expect(requerimientos.body).toEqual({ modulo: 'requerimientos', status: 'placeholder' });

      const importacion = await request(app.getHttpServer())
        .get('/api/importacion/ping')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(200);
      expect(importacion.body).toEqual({ modulo: 'importacion', status: 'placeholder' });

      // Mismos pings, un rol de negocio: 403 (la herencia NO es de todos).
      await request(app.getHttpServer())
        .get('/api/requerimientos/ping')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(403);
    });

    it('crea candidatos (poder de admin_rrhh) y un lider_area recibe 403', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({
          nombres: 'Candidato Herencia',
          apellidos: 'Superusuario SU',
          email: 'e2e-usuarios-candidato@larco.co',
          cedula: CEDULA_SU,
          ciudad: 'E2E Usuarios',
        })
        .expect(201);
      expect(response.body.id).toEqual(expect.any(String));

      const denegado = await request(app.getHttpServer())
        .post('/api/candidatos')
        .set('Authorization', `Bearer ${tokenLider}`)
        .send({
          nombres: 'No',
          apellidos: 'Debe Pasar',
          cedula: `${CEDULA_BASE}99`,
          ciudad: 'E2E Usuarios',
        })
        .expect(403);
      expect(denegado.body.message).toBe('No tienes permiso para realizar esta acción');
    });

    it('POST /api/postulaciones: superusuario supera el RBAC (400 de forma) y lider_area recibe 403', async () => {
      // `@Roles` de postulaciones incluye superusuario: un cuerpo vacío cae en
      // la VALIDACIÓN (400), no en la autorización — eso prueba la herencia.
      await request(app.getHttpServer())
        .post('/api/postulaciones')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({})
        .expect(400);

      const denegado = await request(app.getHttpServer())
        .post('/api/postulaciones')
        .set('Authorization', `Bearer ${tokenLider}`)
        .send({})
        .expect(403);
      expect(denegado.body.message).toBe('No tienes permiso para realizar esta acción');
    });

    it('POST /api/requerimientos: superusuario supera el RBAC (400 de forma) y un analista recibe 403', async () => {
      await request(app.getHttpServer())
        .post('/api/requerimientos')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({})
        .expect(400);

      const denegado = await request(app.getHttpServer())
        .post('/api/requerimientos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .send({})
        .expect(403);
      expect(denegado.body.message).toBe('No tienes permiso para realizar esta acción');
    });
  });
});
