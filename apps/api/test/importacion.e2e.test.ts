import './helpers/dev-db-env'; // ANTES que test-env: carga el .env raíz (BD dev docker)
import './helpers/test-env';

import { createHash, randomInt, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { AlmacenamientoService } from '../src/modules/uploads/almacenamiento.service';
import { ArchivosCvService } from '../src/modules/uploads/archivos-cv.service';

/**
 * Importación masiva de HVs — Etapa 9 (retroalimentación):
 * `POST /api/importacion/hvs`, contra la BD DEV REAL de docker.
 *
 * Los PDFs de prueba se GENERAN EN MEMORIA (un PDF mínimo válido construido a
 * mano, con los seis campos obligatorios en su stream de texto). Cubre:
 * creación del candidato completo + CV adjunto + departamento destino, el aislamiento de
 * fallos por archivo (no-PDF y email duplicado no cancelan el lote), el 404
 * del destino inexistente, el 400 del lote vacío y el RBAC.
 *
 * ACCESO: el pool `pg` GLOBAL (`DatabaseService`); tokens con el `JwtService`
 * global. El admin sale del seed 002 (`admin@larco.co`). El email del PDF lleva
 * el SUFIJO ÚNICO de la ejecución: es la marca con la que `afterAll` borra los
 * candidatos importados de la BD dev.
 */

const ADMIN_EMAIL = 'admin@larco.co';

/** Sufijo único por ejecución: marca el email del PDF y aísla la limpieza. */
const SUFIJO_UNICO = `${Date.now().toString(36)}-${randomInt(100000, 999999)}`;

/** Email que el heurístico extraerá del PDF (marca de limpieza). */
const EMAIL_IMPORTADO = `importado-${SUFIJO_UNICO}@correo.test`;
const CEDULA_IMPORTADA = String(Date.now()).slice(-10);
const EMAIL_FALLO_ADJUNTO = `fallo-adjunto-${SUFIJO_UNICO}@correo.test`;
const CEDULA_FALLO_ADJUNTO = `${randomInt(1000000, 9999999)}`;
const EMAIL_SIN_CAMPOS = `sin-campos-${SUFIJO_UNICO}@correo.test`;
const EMAIL_CONFIRMADA = `confirmada-${SUFIJO_UNICO}@correo.test`;

/**
 * Construye un PDF mínimo VÁLIDO (catálogo/página/contenido/fuente + xref con
 * offsets reales) cuyo stream de texto contiene `lineas`. Sin él, la suite
 * dependería de un binario commiteado; generarlo en memoria lo mantiene
 * legible y autocontenido. Solo caracteres ASCII en el texto (el encoding
 * octal de pdf.js no se necesita y confundiría la heurística de nombres).
 */
function crearPdf(lineas: string[]): Buffer {
  // `Td` reposiciona el cursor entre líneas (SALTOS DE LÍNEA reales para el
  // extractor de pdf.js; `T*` no los produce y todo saldría concatenado, lo
  // que rompería la heurística de nombres).
  const cuerpo = lineas
    .map((linea, indice) => `${indice === 0 ? '' : '0 -14 Td '}(${linea}) Tj`)
    .join(' ');
  const stream = `BT /F1 12 Tf 50 700 Td ${cuerpo} ET`;
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((objeto, indice) => {
    offsets.push(pdf.length);
    pdf += `${indice + 1} 0 obj\n${objeto}\nendobj\n`;
  });
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** El HV canónico del test: nombre en la 1ª línea, cargo y email debajo. */
function pdfValido(): Buffer {
  return pdfConDatos(EMAIL_IMPORTADO, CEDULA_IMPORTADA);
}

function pdfConDatos(email: string, cedula: string): Buffer {
  return crearPdf([
    'Martha Importada Prueba',
    'Profesional de Sistemas',
    email,
    '3001234567',
    'Medellin',
    `C.C. ${cedula}`,
  ]);
}

function pdfSinCamposDeContacto(): Buffer {
  return crearPdf(['Martha Importada Sin Campos', EMAIL_SIN_CAMPOS]);
}

function pdfConHabilidades(): Buffer {
  return crearPdf([
    'Martha Importada Revisable',
    EMAIL_CONFIRMADA,
    'TypeScript React PostgreSQL',
    'Medellin',
  ]);
}

describe('Importación masiva de HVs — e2e (BD dev docker real)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let database: DatabaseService;
  let archivosCv: ArchivosCvService;
  let almacenamiento: AlmacenamientoService;

  let tokenAdmin: string;
  let tokenLider: string;

  /** Departamento REAL del seed 009 (destino válido del lote). */
  let departamentoId = '';
  /** Candidato creado por la importación (la marca de limpieza es su email). */
  let candidatoImportadoId = '';

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
    archivosCv = app.get(ArchivosCvService);
    almacenamiento = app.get(AlmacenamientoService);

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
      email: 'e2e-import-lider@larco.test',
      role: 'lider_area',
    });

    const dptos = await database.query<{ id: string }>(
      `SELECT id FROM departamentos WHERE nombre = 'SISTEMAS'`,
    );
    departamentoId = dptos.rows[0]?.id ?? '';
    if (departamentoId === '') {
      throw new Error('No se encontró el departamento SISTEMAS del seed (migración 009)');
    }
  });

  afterAll(async () => {
    await app?.close();
    if (database !== undefined) {
      // La marca de limpieza es el email único incrustado en el PDF: borra los
      // candidatos importados (los CV caen con CASCADE) sin tocar nada ajeno.
      await database
        .query(
          `DELETE FROM candidatos
             WHERE email = ANY($1::text[])
                OR email LIKE $2`,
          [
            [EMAIL_IMPORTADO, EMAIL_SIN_CAMPOS, EMAIL_FALLO_ADJUNTO, EMAIL_CONFIRMADA],
            `t12-lote-${SUFIJO_UNICO}-%@correo.test`,
          ],
        )
        .catch(() => undefined);
    }
  });

  it('sin token → 401; con lider_area → 403 (rol no incluido)', async () => {
    await request(app.getHttpServer()).post('/api/importacion/hvs').expect(401);

    await request(app.getHttpServer())
      .post('/api/importacion/hvs')
      .set('Authorization', `Bearer ${tokenLider}`)
      .expect(403);
  });

  it('lote vacío → 400; destino inexistente → 404', async () => {
    await request(app.getHttpServer())
      .post('/api/importacion/hvs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('departamentoId', departamentoId)
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/importacion/hvs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('departamentoId', randomUUID())
      .attach('archivos', pdfValido(), {
        filename: 'hv-prueba.pdf',
        contentType: 'application/pdf',
      })
      .expect(404);
  });

  it('un PDF válido crea el candidato completo, con el área destino y el CV adjunto', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/importacion/hvs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('departamentoId', departamentoId)
      .attach('archivos', pdfValido(), {
        filename: 'hv-martha-importada.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);

    expect(response.body).toMatchObject({ procesados: 1, creados: 1, fallidos: 0 });
    expect(response.body.resultados[0]).toMatchObject({ ok: true });

    candidatoImportadoId = response.body.resultados[0].candidatoId;
    expect(candidatoImportadoId).toBeDefined();

    // El candidato existe con los datos EXTRAÍDOS del PDF, incluida la PII
    // cifrada obligatoria para esta vía de alta.
    const candidato = await database.query<{
      nombres: string;
      apellidos: string;
      email: string | null;
      departamento_id: string | null;
      cedula_cifrada: string | null;
      cedula_hash: string | null;
    }>(
      'SELECT nombres, apellidos, email, departamento_id, cedula_cifrada, cedula_hash FROM candidatos WHERE id = $1',
      [candidatoImportadoId],
    );
    const fila = candidato.rows[0];
    expect(fila?.nombres).toBe('Martha');
    expect(fila?.apellidos).toBe('Importada Prueba');
    expect(fila?.email).toBe(EMAIL_IMPORTADO);
    expect(fila?.departamento_id).toBe(departamentoId);
    expect(fila?.cedula_cifrada).toMatch(/^v1:/);
    expect(fila?.cedula_hash).toMatch(/^[0-9a-f]{64}$/);

    // El PDF quedó adjunto como CV del candidato (subida vía ArchivosCvService).
    const archivos = await request(app.getHttpServer())
      .get(`/api/candidatos/${candidatoImportadoId}/archivos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(archivos.body).toHaveLength(1);
    expect(archivos.body[0].filenameOriginal).toBe('hv-martha-importada.pdf');
  });

  it('previsualiza campos y habilidades sin crear; confirma solo la revisión editada', async () => {
    const archivo = pdfConHabilidades();
    const preview = await request(app.getHttpServer())
      .post('/api/importacion/hvs/previsualizar')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('archivos', archivo, { filename: 'hv-revisable.pdf', contentType: 'application/pdf' })
      .expect(200);

    expect(preview.body.resultados[0]).toMatchObject({
      ok: true,
      sugerencias: {
        nombres: 'Martha',
        apellidos: 'Importada Revisable',
        habilidades: ['TypeScript', 'React', 'PostgreSQL'],
      },
    });
    expect(
      (await database.query('SELECT id FROM candidatos WHERE email = $1', [EMAIL_CONFIRMADA])).rows,
    ).toHaveLength(0);

    const revisiones = JSON.stringify([
      {
        indice: 0,
        nombres: 'María Editada',
        apellidos: 'Confirmada Manualmente',
        email: EMAIL_CONFIRMADA,
        telefono: null,
        ciudad: 'Bogotá',
        habilidades: ['TypeScript', 'React'],
      },
    ]);
    const confirmacion = await request(app.getHttpServer())
      .post('/api/importacion/hvs/confirmar')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('departamentoId', departamentoId)
      .field('revisiones', revisiones)
      .attach('archivos', archivo, { filename: 'hv-revisable.pdf', contentType: 'application/pdf' })
      .expect(200);

    expect(confirmacion.body).toMatchObject({ procesados: 1, creados: 1, fallidos: 0 });
    const fila = await database.query<{ nombres: string; apellidos: string; ciudad: string }>(
      'SELECT nombres, apellidos, ciudad FROM candidatos WHERE email = $1',
      [EMAIL_CONFIRMADA],
    );
    expect(fila.rows[0]).toEqual({
      nombres: 'María Editada',
      apellidos: 'Confirmada Manualmente',
      ciudad: 'Bogotá',
    });
  });

  it('un PDF sin cédula, teléfono ni ciudad conserva esos campos como NULL', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/importacion/hvs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('departamentoId', departamentoId)
      .attach('archivos', pdfSinCamposDeContacto(), {
        filename: 'hv-sin-campos.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);

    expect(response.body).toMatchObject({ procesados: 1, creados: 1, fallidos: 0 });
    const candidato = await database.query<{
      cedula_cifrada: string | null;
      cedula_hash: string | null;
      telefono_cifrada: string | null;
      ciudad: string | null;
    }>(
      'SELECT cedula_cifrada, cedula_hash, telefono_cifrada, ciudad FROM candidatos WHERE email = $1',
      [EMAIL_SIN_CAMPOS],
    );
    expect(candidato.rows[0]).toEqual({
      cedula_cifrada: null,
      cedula_hash: null,
      telefono_cifrada: null,
      ciudad: null,
    });
  });

  it('mide lote máximo de 50 PDFs sintéticos sin cola ni OCR', async () => {
    const baseCedula = 8000000000 + (Date.now() % 100000000);
    const archivos = Array.from({ length: 50 }, (_, indice) => ({
      buffer: pdfConDatos(
        `t12-lote-${SUFIJO_UNICO}-${indice}@correo.test`,
        String(baseCedula + indice),
      ),
      filename: `t12-lote-${indice}.pdf`,
    }));
    const memoriaAntes = process.memoryUsage().rss;
    const inicio = performance.now();
    let peticion = request(app.getHttpServer())
      .post('/api/importacion/hvs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('departamentoId', departamentoId);
    for (const archivo of archivos) {
      peticion = peticion.attach('archivos', archivo.buffer, {
        filename: archivo.filename,
        contentType: 'application/pdf',
      });
    }
    const response = await peticion.expect(200);
    const duracionMs = Math.round(performance.now() - inicio);
    const memoriaDespues = process.memoryUsage().rss;
    console.info(
      JSON.stringify({
        medicion: 'T12-importacion-50-pdf',
        procesados: response.body.procesados,
        creados: response.body.creados,
        duracionMs,
        rssAntesMiB: Math.round((memoriaAntes / 1024 / 1024) * 10) / 10,
        rssDespuesMiB: Math.round((memoriaDespues / 1024 / 1024) * 10) / 10,
        deltaRssMiB: Math.round(((memoriaDespues - memoriaAntes) / 1024 / 1024) * 10) / 10,
      }),
    );
    expect(response.body).toMatchObject({ procesados: 50, creados: 50, fallidos: 0 });
  });

  it('un archivo no-PDF y un email duplicado fallan POR ARCHIVO sin cancelar el lote', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/importacion/hvs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('departamentoId', departamentoId)
      // (1) Un .txt disfrazado: magic bytes no son PDF → fallo de ESE archivo.
      .attach('archivos', Buffer.from('esto no es un PDF, es texto plano'), {
        filename: 'no-es-pdf.txt',
        contentType: 'text/plain',
      })
      // (2) El mismo HV válido OTRA vez: email ya importado → fallo de ESE archivo.
      .attach('archivos', pdfValido(), {
        filename: 'hv-duplicado.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);

    expect(response.body).toMatchObject({ procesados: 2, creados: 0, fallidos: 2 });

    const [noPdf, duplicado] = response.body.resultados;
    expect(noPdf.ok).toBe(false);
    expect(String(noPdf.motivo)).toContain('no es un PDF');
    expect(duplicado.ok).toBe(false);
    expect(String(duplicado.motivo)).toContain('Ya existe un candidato con el email');

    // La importación es transaccional POR ARCHIVO: el email duplicado NO creó
    // un segundo candidato (el índice único de email lo impediría igualmente).
    const duplicados = await database.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM candidatos WHERE email = $1',
      [EMAIL_IMPORTADO],
    );
    expect(duplicados.rows[0]?.total).toBe(1);
  });

  it('un PDF ilegible se reporta sin crear candidato', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/importacion/hvs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('departamentoId', departamentoId)
      .attach('archivos', Buffer.from('%PDF-1.4\n%%EOF', 'latin1'), {
        filename: 'hv-ilegible.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);

    expect(response.body).toMatchObject({ procesados: 1, creados: 0, fallidos: 1 });
    expect(response.body.resultados[0].ok).toBe(false);
  });

  it('revierte candidato si falla el adjunto, incluso después de escribir el blob', async () => {
    const archivo = pdfConDatos(EMAIL_FALLO_ADJUNTO, CEDULA_FALLO_ADJUNTO);
    const sha256 = createHash('sha256').update(archivo).digest('hex');
    const guardarOriginal = almacenamiento.guardar.bind(almacenamiento);
    const guardar = vi.spyOn(almacenamiento, 'guardar').mockImplementation(async (buffer) => {
      const resultado = await guardarOriginal(buffer);
      throw new Error(`fallo sintético después del fichero ${resultado.sha256}`);
    });

    const response = await request(app.getHttpServer())
      .post('/api/importacion/hvs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('departamentoId', departamentoId)
      .attach('archivos', archivo, {
        filename: 'hv-fallo-adjunto.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);

    expect(response.body).toMatchObject({ procesados: 1, creados: 0, fallidos: 1 });
    expect(String(response.body.resultados[0].motivo)).toContain('No se pudo adjuntar el CV');
    const candidatos = await database.query('SELECT id FROM candidatos WHERE email = $1', [
      EMAIL_FALLO_ADJUNTO,
    ]);
    expect(candidatos.rows).toHaveLength(0);
    expect(await almacenamiento.existe(sha256)).toBe(true);

    guardar.mockRestore();
    await rm(almacenamiento.ruta(sha256), { force: true });
  });

  it('un fallo de la fila del CV no elimina un blob existente', async () => {
    const archivo = pdfValido();
    const sha256 = createHash('sha256').update(archivo).digest('hex');
    expect(await almacenamiento.existe(sha256)).toBe(true);
    const subir = vi
      .spyOn(archivosCv, 'subirEnTransaccion')
      .mockRejectedValueOnce(new Error('fallo sintético entre fichero y fila'));

    const email = `fallo-fila-${SUFIJO_UNICO}@correo.test`;
    const response = await request(app.getHttpServer())
      .post('/api/importacion/hvs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('departamentoId', departamentoId)
      .attach('archivos', pdfConDatos(email, `${randomInt(1000000, 9999999)}`), {
        filename: 'hv-fallo-fila.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);

    expect(response.body.creados).toBe(0);
    expect(
      await database.query('SELECT id FROM candidatos WHERE email = $1', [email]),
    ).toMatchObject({
      rows: [],
    });
    expect(await almacenamiento.existe(sha256)).toBe(true);
    subir.mockRestore();
  });
});
