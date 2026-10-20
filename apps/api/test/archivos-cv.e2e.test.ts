import './helpers/dev-db-env'; // ANTES que test-env: carga el .env raíz (BD dev docker)
import './helpers/test-env';

import { createHash, randomInt, randomUUID } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import type { Candidato } from '../src/modules/candidatos/candidato.entity';
import { CandidatosStoreService } from '../src/modules/candidatos/candidatos-store.service';
import { AlmacenamientoService } from '../src/modules/uploads/almacenamiento.service';

/**
 * Archivos de CV — Fase 4, parte 2: subida con validación de MAGIC BYTES, dedup
 * por SHA-256 y descarga autorizada, contra la BD DEV REAL de docker.
 *
 * ⚠ ESTE test usa la base de datos de desarrollo (`DATABASE_URL` del `.env`
 * raíz → localhost:5432/ats_dev). Motivo: lo que se verifica es DE POSTGRESQL y
 * del disco REAL — el índice único `UNIQUE (candidato_id, sha256)` de la
 * migración 006, el trigger `archivos_cv_audit_log`, la FK `ON DELETE CASCADE`
 * y el fichero `<UPLOAD_DIR>/<sha256>` escrito byte a byte—. Falsear la base o
 * el sistema de archivos demostraría exactamente nada.
 *
 * ACCESO A LA BD: se usa el `DataSource` LAZY del módulo de candidatos (vía
 * `CandidatosStoreService.repo()`), MISMO criterio que
 * `candidatos-crud.e2e.test.ts`: al registrar varios módulos con su PROPIO
 * `DataSource`, `app.get(DataSource)` sería ambiguo.
 *
 * AISLAMIENTO Y REPETIBILIDAD:
 *  - Los tokens se firman con el `JwtService` global (mismo `JWT_SECRET`).
 *  - Los `sub` son UUIDs de usuarios REALES (el `created_by` de `archivos_cv`
 *    tiene FK a `users(id)`): se LEEN/CREAN en `beforeAll` y se BORRAN en
 *    `afterAll` dentro de una transacción que deshabilita el trigger de
 *    inmutabilidad de `audit_log` (patrón de `candidatos-crud`).
 *  - Los candidatos de prueba se marcan por `ciudad` con un sufijo único.
 *  - El DISCO se limpia con diff: `afterAll` borra SOLO los ficheros cuyo
 *    nombre (sha256) no existía al empezar. `UPLOAD_DIR` de test
 *    (`data/uploads-test`) NO está en `.gitignore`, así que dejar restos
 *    ensuciaría el repositorio; si el directorio queda vacío, se borra también.
 *
 * RATE LIMIT: el throttler global está ACTIVO en `NODE_ENV=test` (100 pet/min).
 * Esta suite hace ~25 peticiones, holgadamente por debajo del límite.
 */

const ADMIN_EMAIL = 'admin@larco.co';

/** Hash de mentira: estos usuarios jamás inician sesión (solo aportan un id). */
const PASSWORD_HASH_FICTICIO = 'no-utilizable-en-tests';

/** Usuarios de prueba (creados y borrados por ESTE test). */
const USUARIOS_DE_PRUEBA = [
  {
    email: 'arch-cv-analista@larco.test',
    fullName: 'Test Arch CV Analista',
    role: 'analista_seleccion',
  },
  { email: 'arch-cv-lider@larco.test', fullName: 'Test Arch CV Lider', role: 'lider_area' },
] as const;

const EMAIL_ANALISTA = USUARIOS_DE_PRUEBA[0].email;
const EMAIL_LIDER = USUARIOS_DE_PRUEBA[1].email;

/** Sufijo único por ejecución: aísla las filas de prueba del resto de la BD dev. */
const SUFIJO_UNICO = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

/** `ciudad` de TODOS los candidatos de prueba: es la marca que usa la limpieza. */
const MARCA = `Ciudad-ArchCV-${SUFIJO_UNICO}`;

/**
 * Cédulas únicas por ejecución (6-10 dígitos, como exige el DTO de candidatos).
 * Prefijo ALEATORIO, no `Date.now()`: otros ficheros de e2e comparten el mismo
 * patrón de sufijos (11/22/33/44) y un timestamp idéntico al cargar en el mismo
 * milisegundo provocaba 409 en el beforeAll (archivos enteros salteados).
 */
const BASE_CEDULA = randomInt(1000000, 10000000).toString();
const CEDULA_PRINCIPAL = `${BASE_CEDULA}11`;
const CEDULA_SEGUNDO = `${BASE_CEDULA}22`;
const CEDULA_TERCERO = `${BASE_CEDULA}33`;
const CEDULA_VACIO = `${BASE_CEDULA}44`;

/** Límite de Multer declarado en el controlador (5 MB). */
const LIMITE_TAMANO_CV = 5 * 1024 * 1024;

/** SHA-256 (hex) del contenido: es además el NOMBRE del fichero en disco. */
function sha256De(contenido: Buffer): string {
  return createHash('sha256').update(contenido).digest('hex');
}

/**
 * PDF de mentira: solo la firma `%PDF-1.7` (lo único que mira el detector) más
 * relleno. El contenido REAL del CV es irrelevante para este test.
 */
function pdfDePrueba(semilla: string): Buffer {
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n', 'latin1'),
    Buffer.from(`% contenido de prueba ${semilla}\n`, 'latin1'),
  ]);
}

/** RTF de mentira: la firma `{\rtf1` basta para que el detector lo acepte. */
function rtfDePrueba(semilla: string): Buffer {
  return Buffer.from(`{\\rtf1\\ansi ${semilla}}`, 'latin1');
}

/** Buffer VÁLIDO de más de 5 MB (firma PDF + relleno) para probar el 413. */
function pdfMasGrandeQueElLimite(): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(LIMITE_TAMANO_CV, 0x20)]);
}

describe('Archivos de CV — subida, dedup y descarga e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let appInicializado = false;
  let jwt: JwtService;

  // Repo LAZY del módulo de candidatos (SQL crudo + transacciones de limpieza).
  let repo: Repository<Candidato>;
  let store: CandidatosStoreService;

  /** Almacén real de la app: da el directorio ABSOLUTO de subidas para el diff. */
  let almacenamiento: AlmacenamientoService;
  let directorioSubidas: string;
  /** Ficheros que había en el almacén ANTES de la suite (nunca se tocan). */
  let ficherosIniciales = new Set<string>();

  let creadorId: string;
  let tokenAnalista: string;
  let tokenLider: string;

  /** Principal: recibe el PDF, el duplicado (409) y el nombre acentuado. */
  let candidatoPrincipal: { id: string };
  /** Segundo: recibe el MISMO bytes que el principal (dedup de almacenamiento). */
  let candidatoSegundo: { id: string };
  /** Tercero: MIME derivado, .txt/.png rechazados, 403 y 413. */
  let candidatoTercero: { id: string };
  /** Cuarto: SIEMPRE vacío, para el listado sin archivos (200 + `[]`). */
  let candidatoVacio: { id: string };

  /** Metadatos del archivo A (PDF del principal), reutilizados por descargas. */
  let archivoPrincipal: { id: string; sha256: string };

  /** Contenido del PDF del principal: es el que debe volver byte a byte. */
  const contenidoPrincipal = pdfDePrueba(`principal-${SUFIJO_UNICO}`);

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || url.includes('127.0.0.1:5555')) {
      // test-env fija esa URL falsa como último recurso: aquí haría falta la
      // BD dev real. Falla temprano y con mensaje claro si docker no corre.
      throw new Error(
        'Este test necesita la BD dev de docker: revisa docker-compose.dev.yml y el .env raíz (DATABASE_URL)',
      );
    }

    // AppModule REAL, sin overrides: la validación de magic bytes, el almacén y
    // la transacción con GUC de auditoría son exactamente los de producción.
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
    almacenamiento = app.get(AlmacenamientoService, { strict: false });
    directorioSubidas = almacenamiento.directorio;
    ficherosIniciales = new Set(await ficherosEnAlmacen());

    // El admin del seed 002 es el único admin_rrhh real de la BD dev.
    const admins = (await repo.query('SELECT id FROM users WHERE email = $1', [
      ADMIN_EMAIL,
    ])) as Array<{ id: string }>;
    if (!admins[0]) {
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

    tokenAnalista = jwt.sign({
      sub: creadorId,
      email: EMAIL_ANALISTA,
      role: 'analista_seleccion',
    });
    tokenLider = jwt.sign({ sub: idDe(EMAIL_LIDER), email: EMAIL_LIDER, role: 'lider_area' });

    // Fixtures: los cuatro candidatos de prueba (vía API real, con PII cifrada).
    candidatoPrincipal = await crearFixture('Zoraida', CEDULA_PRINCIPAL);
    candidatoSegundo = await crearFixture('Baltasar', CEDULA_SEGUNDO);
    candidatoTercero = await crearFixture('Gaspar', CEDULA_TERCERO);
    // Este NUNCA recibe archivos: su listado debe ser un `[]` de 200.
    candidatoVacio = await crearFixture('Melchor', CEDULA_VACIO);
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
        // `archivos_cv.created_by` es FK a `users(id)` SIN ON DELETE: se borra
        // ANTES que los usuarios para no violar esa clave foránea. Los ficheros
        // EN DISCO no se tocan aquí (se limpian al final, con diff).
        await em.query(
          'DELETE FROM archivos_cv WHERE candidato_id IN (SELECT id FROM candidatos WHERE ciudad = $1)',
          [MARCA],
        );
        await em.query('DELETE FROM candidatos WHERE ciudad = $1', [MARCA]);
        // `audit_log.changed_by` es FK con ON DELETE SET NULL: borrar usuarios
        // provocaría un UPDATE sobre `audit_log`, que su trigger rechaza. Se
        // deshabilita SOLO dentro de esta transacción. Las filas de
        // `audit_log` se CONSERVAN (inmutables por diseño).
        await em.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutation');
        await em.query('DELETE FROM users WHERE email = ANY($1::text[])', [
          USUARIOS_DE_PRUEBA.map((usuario) => usuario.email),
        ]);
        await em.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_mutation');
      });
    }

    await app.close();

    // DISCO: se borra SOLO el diff (ficheros creados por ESTE test). El sha256
    // es el nombre, así que basta con comparar listados: nunca se toca un
    // fichero ajeno aunque otra suite comparta el mismo directorio.
    const creados = (await ficherosEnAlmacen()).filter((nombre) => !ficherosIniciales.has(nombre));
    await Promise.all(
      creados.map((nombre) => rm(join(directorioSubidas, nombre), { force: true })),
    );
    // Si el directorio era exclusivo de esta suite, se borra también.
    if (ficherosIniciales.size === 0 && creados.length > 0) {
      await rm(directorioSubidas, { recursive: true, force: true });
    }
  });

  // ───────────────────────── helpers ─────────────────────────

  /** Ficheros del almacén (vacío si el directorio todavía no existe). */
  async function ficherosEnAlmacen(): Promise<string[]> {
    try {
      return (await readdir(directorioSubidas)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /** POST un candidato como el analista creador y devuelve `{ id }`. */
  async function crearFixture(nombres: string, cedula: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/candidatos')
      .set('Authorization', `Bearer ${tokenAnalista}`)
      .send({
        nombres: `${nombres} ${SUFIJO_UNICO}`,
        apellidos: `Prueba ${SUFIJO_UNICO}`,
        cedula,
        ciudad: MARCA,
      })
      .expect(201);
    return { id: response.body.id as string };
  }

  /**
   * Sube un CV por multipart al candidato indicado.
   *
   * El `contentType` declarado se pasa A PROPÓSITO para los casos en que se
   * quiere demostrar que el servidor LO IGNORA (decisión de magic bytes).
   */
  function subir(
    candidatoId: string,
    archivo: { buffer: Buffer; filename: string; contentType?: string },
    token: string,
  ) {
    return request(app.getHttpServer())
      .post(`/api/candidatos/${candidatoId}/archivos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', archivo.buffer, {
        filename: archivo.filename,
        ...(archivo.contentType === undefined ? {} : { contentType: archivo.contentType }),
      });
  }

  /**
   * Descarga un CV: `response.body` es un `Buffer` con los bytes EXACTOS.
   *
   * Se usa el parser por DEFECTO de superagent (sin `.buffer()` ni
   * `.responseType()`) y eso es deliberado: con `Content-Type: application/pdf`
   * superagent NO lo considera «binary» (solo `audio|font|image|video` y gzip),
   * pero tampoco es texto ni JSON, así que cae al parser genérico de Buffer
   * (`parse.image`, «It's actually a generic Buffer»). Un `.buffer(true)` en
   * cambio escogería `parse.text` (UTF-8) y CORROMPERÍA los bytes del PDF.
   *
   * La ventaja de no fijar nada es que los ERRORES (JSON, `application/json`)
   * siguen parseándose como objeto, mientras que el 200 del PDF llega como
   * Buffer: el mismo helper sirve para ambos. Las aserciones de la prueba de
   * descarga comprueban `Buffer.isBuffer(cuerpo)` y el hash, así que cualquier
   * cambio de ese comportamiento futuro saltaría aquí.
   */
  function descargar(candidatoId: string, archivoId: string, token: string) {
    return request(app.getHttpServer())
      .get(`/api/candidatos/${candidatoId}/archivos/${archivoId}/descarga`)
      .set('Authorization', `Bearer ${token}`);
  }

  // ───────────────────────── POST subida ─────────────────────────

  describe('POST /api/candidatos/:id/archivos', () => {
    it('un PDF válido → 201 con los metadatos EXACTOS, el fichero en disco y la auditoría', async () => {
      const sha256 = sha256De(contenidoPrincipal);

      const response = await subir(
        candidatoPrincipal.id,
        {
          buffer: contenidoPrincipal,
          filename: 'cv-principal.pdf',
          // Declaración DEL CLIENTE, deliberadamente FALSA: el servidor debe
          // ignorarla y derivar `application/pdf` de los magic bytes.
          contentType: 'application/x-msdownload',
        },
        tokenAnalista,
      ).expect(201);

      // Forma PÚBLICA exacta (sin `createdBy`, sin ruta, sin columnas internas).
      expect(response.body).toEqual({
        id: expect.any(String),
        filenameOriginal: 'cv-principal.pdf',
        mimeType: 'application/pdf',
        sizeBytes: contenidoPrincipal.length,
        sha256,
        candidatoId: candidatoPrincipal.id,
        createdAt: expect.any(String),
      });
      // Ningún campo extra se cuela en la respuesta.
      expect(Object.keys(response.body).sort()).toEqual([
        'candidatoId',
        'createdAt',
        'filenameOriginal',
        'id',
        'mimeType',
        'sha256',
        'sizeBytes',
      ]);

      // El fichero en disco se llama EXACTAMENTE como su hash y contiene los
      // bytes SUBIDOS, no los declarados (dedup + integridad por nombre).
      expect(await readFile(join(directorioSubidas, sha256))).toEqual(contenidoPrincipal);

      // En BD la fila apunta al hash y el `created_by` es quien subió.
      const filas = (await repo.query(
        'SELECT candidato_id, sha256, mime_type, size_bytes, created_by FROM archivos_cv WHERE id = $1',
        [response.body.id],
      )) as Array<{
        candidato_id: string;
        sha256: string;
        mime_type: string;
        size_bytes: string;
        created_by: string;
      }>;
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        candidato_id: candidatoPrincipal.id,
        sha256,
        mime_type: 'application/pdf',
        size_bytes: String(contenidoPrincipal.length),
        created_by: creadorId,
      });

      // Auditoría: el trigger 006 registra QUIÉN subió el archivo. `audit_fila`
      // usa el GUC `app.current_user_id` que el servicio fija con el `sub`.
      const auditoria = (await repo.query(
        'SELECT action, changed_by FROM audit_log WHERE table_name = $1 AND record_id = $2',
        ['archivos_cv', response.body.id],
      )) as Array<{ action: string; changed_by: string }>;
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ action: 'INSERT', changed_by: creadorId });

      archivoPrincipal = { id: response.body.id as string, sha256 };
    });

    it('el MIME devuelto lo DERIVA el servidor del contenido, no del cliente', async () => {
      // RTF (firma `{\rtf1`) declarado como `application/pdf`: la respuesta y la
      // BD deben decir `application/rtf`. Es la regresión central de la decisión
      // de magic bytes.
      const contenido = rtfDePrueba(`mime-${SUFIJO_UNICO}`);

      const response = await subir(
        candidatoTercero.id,
        { buffer: contenido, filename: 'hoja-de-vida.rtf', contentType: 'application/pdf' },
        tokenAnalista,
      ).expect(201);

      expect(response.body.mimeType).toBe('application/rtf');
      expect(response.body.sha256).toBe(sha256De(contenido));

      // Y en BD persiste el MIME derivado, jamás el declarado por el cliente.
      const filas = (await repo.query('SELECT mime_type FROM archivos_cv WHERE id = $1', [
        response.body.id,
      ])) as Array<{ mime_type: string }>;
      expect(filas[0]?.mime_type).toBe('application/rtf');
    });

    it('un nombre con tildes y ñ se conserva EXACTO (defParamCharset utf8)', async () => {
      // Regresión de `defParamCharset: 'utf8'` en `FileInterceptor`: el default
      // de Multer es latin1 y el nombre saldría «mojibake» en la descarga.
      const nombreAcentuado = `CV Andrés Ñandú ${SUFIJO_UNICO}.pdf`;
      const contenido = pdfDePrueba(`acentos-${SUFIJO_UNICO}`);

      const response = await subir(
        candidatoPrincipal.id,
        { buffer: contenido, filename: nombreAcentuado, contentType: 'application/pdf' },
        tokenAnalista,
      ).expect(201);

      expect(response.body.filenameOriginal).toBe(nombreAcentuado);
    });

    it('el MISMO contenido en el MISMO candidato → 409 (ya está adjunto)', async () => {
      const response = await subir(
        candidatoPrincipal.id,
        {
          buffer: contenidoPrincipal,
          filename: 'copia-del-mismo.pdf',
          contentType: 'application/pdf',
        },
        tokenAnalista,
      ).expect(409);

      expect(response.body.message).toBe('El archivo ya está adjunto a este candidato');
      expect(response.body.statusCode).toBe(409);

      // Solo existe UNA fila para ese par (candidato, sha256).
      const filas = (await repo.query(
        'SELECT id FROM archivos_cv WHERE candidato_id = $1 AND sha256 = $2',
        [candidatoPrincipal.id, sha256De(contenidoPrincipal)],
      )) as Array<{ id: string }>;
      expect(filas).toHaveLength(1);
    });

    it('el MISMO contenido en OTRO candidato → 201 y UN SOLO fichero en disco', async () => {
      // Dedup de ALMACENAMIENTO (no de metadatos): dos personas pueden adjuntar
      // la misma plantilla y el disco solo paga una vez.
      const antes = await ficherosEnAlmacen();

      const response = await subir(
        candidatoSegundo.id,
        {
          buffer: contenidoPrincipal,
          filename: 'otro-cv-mismo-bytes.pdf',
          contentType: 'application/pdf',
        },
        tokenAnalista,
      ).expect(201);

      expect(response.body.candidatoId).toBe(candidatoSegundo.id);
      expect(response.body.sha256).toBe(sha256De(contenidoPrincipal));
      // NI UN fichero nuevo: el contenido ya estaba en disco por el candidato A.
      expect(await ficherosEnAlmacen()).toEqual(antes);
      expect(antes).toContain(sha256De(contenidoPrincipal));

      // PERO sí hay una fila NUEVA, con su propio nombre y autoría.
      const filas = (await repo.query(
        'SELECT filename_original, created_by FROM archivos_cv WHERE candidato_id = $1 AND sha256 = $2',
        [candidatoSegundo.id, sha256De(contenidoPrincipal)],
      )) as Array<{ filename_original: string; created_by: string }>;
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        filename_original: 'otro-cv-mismo-bytes.pdf',
        created_by: creadorId,
      });
    });

    it('un .txt y un .png → 400 (magic bytes, ni la extensión ni el MIME mandan)', async () => {
      const respuestaTxt = await subir(
        candidatoTercero.id,
        {
          buffer: Buffer.from('Esto es un CV en texto plano, no un PDF.\n'),
          filename: 'cv.txt',
          contentType: 'application/pdf', // declarado como PDF, contenido .txt
        },
        tokenAnalista,
      ).expect(400);

      expect(respuestaTxt.body.message).toBe(
        'Tipo de archivo no permitido. Se aceptan PDF, DOC, DOCX y RTF.',
      );

      // `\x89PNG` es una firma VÁLIDA de imagen, pero NO es un CV.
      const respuestaPng = await subir(
        candidatoTercero.id,
        {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          filename: 'foto.png',
          contentType: 'application/pdf',
        },
        tokenAnalista,
      ).expect(400);

      expect(respuestaPng.body.message).toBe(
        'Tipo de archivo no permitido. Se aceptan PDF, DOC, DOCX y RTF.',
      );

      // Ninguno de los dos dejó fila ni fichero detrás.
      const total = (await repo.query(
        `SELECT count(*)::int AS n FROM archivos_cv
          WHERE candidato_id = $1 AND filename_original IN ('cv.txt', 'foto.png')`,
        [candidatoTercero.id],
      )) as Array<{ n: number }>;
      expect(total[0]?.n).toBe(0);
    });

    it('un candidato INEXISTENTE → 404 sin escribir NADA en disco', async () => {
      const antes = await ficherosEnAlmacen();
      const contenido = pdfDePrueba(`fantasma-${SUFIJO_UNICO}`);

      const response = await subir(
        randomUUID(), // candidato que jamás existió
        { buffer: contenido, filename: 'fantasma.pdf', contentType: 'application/pdf' },
        tokenAnalista,
      ).expect(404);

      expect(response.body.message).toContain('No existe un candidato');
      // La comprobación del candidato es ANTES de tocar el disco: cero restos.
      expect(await ficherosEnAlmacen()).toEqual(antes);
      expect(antes).not.toContain(sha256De(contenido));
    });

    it('sin el campo "file" → 400 con mensaje claro', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/candidatos/${candidatoTercero.id}/archivos`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        // Multipart SIN archivo: solo un campo de texto (multer no rellena `file`).
        .field('no-es-un-archivo', 'valor')
        .expect(400);

      expect(response.body.message).toBe(
        'Falta el archivo: envía el CV en el campo "file" (multipart/form-data)',
      );
    });

    it('con rol lider_area → 403 (solo analista_seleccion y admin_rrhh)', async () => {
      const response = await subir(
        candidatoTercero.id,
        {
          buffer: pdfDePrueba(`403-${SUFIJO_UNICO}`),
          filename: 'sin-permisos.pdf',
          contentType: 'application/pdf',
        },
        tokenLider,
      ).expect(403);

      expect(response.body.message).toBe('No tienes permiso para realizar esta acción');
    });

    it('con más de 5 MB → 413 con mensaje en español y sin escribir en disco', async () => {
      const antes = await ficherosEnAlmacen();

      const response = await subir(
        candidatoTercero.id,
        {
          buffer: pdfMasGrandeQueElLimite(),
          filename: 'enorme.pdf',
          contentType: 'application/pdf',
        },
        tokenAnalista,
      ).expect(413);

      // El `LIMIT_FILE_SIZE` de Multer lo traduce `LimiteTamanoInterceptor`
      // («File too large» en inglés sería el texto por defecto de Nest).
      expect(response.body.message).toBe('El archivo supera el tamaño máximo permitido (5 MB)');
      // Ni el fichero gigante ni ningún otro quedaron en disco.
      expect(await ficherosEnAlmacen()).toEqual(antes);
    });
  });

  // ───────────────────────── GET listado ─────────────────────────

  describe('GET /api/candidatos/:id/archivos', () => {
    it('devuelve 200 con los metadatos (más recientes primero) y sin autoría interna', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/candidatos/${candidatoPrincipal.id}/archivos`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      // El principal tiene DOS archivos: el PDF (1º, más antiguo) y el acentuado.
      expect(response.body).toHaveLength(2);
      // Orden por `created_at DESC`: el acentuado (más reciente) va primero.
      expect(response.body[1]).toMatchObject({
        id: archivoPrincipal.id,
        filenameOriginal: 'cv-principal.pdf',
        mimeType: 'application/pdf',
        sha256: archivoPrincipal.sha256,
        sizeBytes: contenidoPrincipal.length,
        candidatoId: candidatoPrincipal.id,
      });
      // `created_by` NUNCA se expone (autoría interna) ni la ruta en disco.
      for (const item of response.body as Array<Record<string, unknown>>) {
        expect(Object.keys(item).sort()).toEqual([
          'candidatoId',
          'createdAt',
          'filenameOriginal',
          'id',
          'mimeType',
          'sha256',
          'sizeBytes',
        ]);
        expect(JSON.stringify(item)).not.toContain(directorioSubidas);
      }
    });

    it('un candidato SIN archivos devuelve un array vacío (200, no 404)', async () => {
      // El candidato existe pero jamás adjuntó nada: la respuesta es un `[]`,
      // NO un 404 (el 404 es solo para un candidato INEXISTENTE).
      const response = await request(app.getHttpServer())
        .get(`/api/candidatos/${candidatoVacio.id}/archivos`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('devuelve 404 con mensaje claro si el candidato no existe', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/candidatos/${randomUUID()}/archivos`)
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(404);

      expect(response.body.message).toContain('No existe un candidato');
    });

    it('devuelve 400 si el id no es un uuid', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/candidatos/no-es-un-uuid/archivos')
        .set('Authorization', `Bearer ${tokenAnalista}`)
        .expect(400);

      expect(response.body.message).toBe('El identificador del candidato debe ser un UUID válido');
    });
  });

  // ───────────────────────── GET descarga ─────────────────────────

  describe('GET /api/candidatos/:id/archivos/:archivoId/descarga', () => {
    it('devuelve 200 con los bytes EXACTOS, el tipo real y el nombre original en UTF-8', async () => {
      const response = await descargar(
        candidatoPrincipal.id,
        archivoPrincipal.id,
        tokenAnalista,
      ).expect(200);

      // Integridad: el cuerpo descargado tiene EXACTAMENTE el sha256 esperado,
      // es decir, los bytes originales llegaron intactos por HTTP.
      const cuerpo = response.body as Buffer;
      expect(Buffer.isBuffer(cuerpo)).toBe(true);
      expect(cuerpo).toEqual(contenidoPrincipal);
      expect(sha256De(cuerpo)).toBe(archivoPrincipal.sha256);

      // Cabeceras: el MIME REAL de la fila (no el que declaró el cliente) y el
      // Content-Disposition con la doble declaración de RFC 6266.
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="cv-principal.pdf"; filename*=UTF-8''cv-principal.pdf`,
      );
      expect(response.headers['content-length']).toBe(String(contenidoPrincipal.length));
    });

    it('sirve un nombre ACENTUADO con el fallback ASCII y el UTF-8 percent-encoded', async () => {
      // Busca el archivo acentuado del principal para leer su `filename_original`
      // desde la propia BD (no se endurece el orden de los tests).
      const filas = (await repo.query(
        `SELECT id, filename_original FROM archivos_cv
          WHERE candidato_id = $1 AND filename_original LIKE $2
          ORDER BY created_at DESC LIMIT 1`,
        [candidatoPrincipal.id, '%Andr_s %'],
      )) as Array<{ id: string; filename_original: string }>;
      expect(filas[0]).toBeDefined();

      const response = await descargar(
        candidatoPrincipal.id,
        filas[0]?.id ?? '',
        tokenAnalista,
      ).expect(200);

      // `filename="…"` sustituye tildes/ñ por `_`; `filename*=UTF-8''…` las
      // conserva. Ambas van en la MISMA cabecera.
      const disposition = String(response.headers['content-disposition']);
      expect(disposition.startsWith('attachment; filename="')).toBe(true);
      expect(disposition).toContain("filename*=UTF-8''");
      // El nombre percent-encoded aparece (tildes y ñ codificadas en UTF-8).
      expect(disposition).toMatch(/filename\*=UTF-8''CV%20Andr%C3%A9s%20%C3%91and%C3%BA%20/);
      // Y el fallback ASCII NO contiene bytes no-ASCII (rompería clientes viejos).
      const fallback = disposition.slice(0, disposition.indexOf('; filename*='));
      expect(fallback).toMatch(/^attachment; filename="[ -~]*"$/);
    });

    it('devuelve 404 si el archivo no existe', async () => {
      const response = await descargar(candidatoPrincipal.id, randomUUID(), tokenAnalista).expect(
        404,
      );

      expect(response.body.message).toContain('No existe el archivo');
    });

    it('devuelve 404 si el archivo pertenece a OTRO candidato', async () => {
      // El archivo A es del principal: servirlo bajo la ruta del segundo debe
      // fallar aunque el id sea REAL (no hay fuga entre candidatos).
      const response = await descargar(
        candidatoSegundo.id,
        archivoPrincipal.id,
        tokenAnalista,
      ).expect(404);

      expect(response.body.message).toContain('No existe el archivo');
    });

    it('devuelve 500 «Archivo corrupto en almacenamiento» si la fila existe y el fichero no', async () => {
      // Se simula un borrado EXTERNO del fichero: la fila sigue apuntando a un
      // sha256 que ya no está en disco. Es una inconsistencia del SERVIDOR, no
      // del cliente, por eso 500 y no 404.
      const shaInexistente = sha256De(Buffer.from(`nunca-escrito-${SUFIJO_UNICO}`));
      const insertado = (await repo.query(
        `INSERT INTO archivos_cv (candidato_id, sha256, filename_original, mime_type, size_bytes, created_by)
         VALUES ($1, $2, 'huérfano.pdf', 'application/pdf', 10, $3)
         RETURNING id`,
        [candidatoPrincipal.id, shaInexistente, creadorId],
      )) as Array<{ id: string }>;
      const archivoId = insertado[0]?.id ?? '';
      // Comprobación previa: ese hash JAMÁS se escribió en disco.
      expect(await almacenamiento.existe(shaInexistente)).toBe(false);

      const response = await descargar(candidatoPrincipal.id, archivoId, tokenAnalista).expect(500);

      expect(response.body.statusCode).toBe(500);
      expect(response.body.message).toBe('Archivo corrupto en almacenamiento');
      // Nunca se revela al cliente dónde está el almacén.
      expect(JSON.stringify(response.body)).not.toContain(directorioSubidas);
    });
  });

  // ───────────────────────── autenticación ─────────────────────────

  it('sin token → 401 en los tres endpoints de archivos', async () => {
    const url = `/api/candidatos/${candidatoPrincipal.id}/archivos`;
    await request(app.getHttpServer()).post(url).expect(401);
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer()).get(`${url}/${archivoPrincipal.id}/descarga`).expect(401);
  });
});
