import './helpers/dev-db-env';
import './helpers/test-env';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/crypto/password.util';

const BASE_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
const EMAIL = `browser-${Date.now()}@synthetic.test`;
const EMAIL_DESCARTADO = `browser-descartado-${Date.now()}@synthetic.test`;
const PASSWORD = 'BrowserSynthetic2026!';
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TITULO_REQUERIMIENTO = `Browser Synthetic ${Date.now()}`;

function pdfSintetico(): Buffer {
  const texto = 'Martha Browser Sintetica\nTypeScript React\nbrowser-cv@synthetic.test';
  const contenido = `BT /F1 12 Tf 72 720 Td (${texto.replaceAll('\n', ') Tj 0 -18 Td (')}) Tj ET`;
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(contenido)} >>\nstream\n${contenido}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objetos.forEach((objeto, indice) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${indice + 1} 0 obj\n${objeto}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function seleccionarDepartamento(pool: Pool): Promise<string> {
  const resultado = await pool.query<{ id: string }>(
    `SELECT id FROM departamentos ORDER BY nombre LIMIT 1`,
  );
  const id = resultado.rows[0]?.id;
  if (id === undefined) throw new Error('No hay departamentos sintéticos para el E2E browser');
  return id;
}

describe('ATS — E2E browser Playwright (datos sintéticos)', () => {
  let pool: Pool;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let departamentoId: string;
  let requerimientoId: string | undefined;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const role = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'admin_rrhh'`);
    const roleId = role.rows[0]?.id;
    if (roleId === undefined) throw new Error('No existe el rol analista_seleccion');
    await pool.query(
      `INSERT INTO users (role_id, email, password_hash, full_name, active)
       VALUES ($1, $2, $3, 'Browser Synthetic', true)`,
      [roleId, EMAIL, await hashPassword(PASSWORD)],
    );
    departamentoId = await seleccionarDepartamento(pool);
    browser = await chromium.launch({ headless: true, executablePath: CHROME });
    context = await browser.newContext({ ignoreHTTPSErrors: BASE_URL.startsWith('https://') });
    page = await context.newPage();
  });

  afterAll(async () => {
    await browser?.close();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (requerimientoId !== undefined) {
          await client.query('DELETE FROM requerimientos WHERE id = $1', [requerimientoId]);
        }
        await client.query('DELETE FROM candidatos WHERE email = $1', [
          'browser-cv@synthetic.test',
        ]);
        await client.query('DELETE FROM candidatos WHERE email = $1', [EMAIL_DESCARTADO]);
        await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutation');
        await client.query(
          'DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
          [EMAIL],
        );
        await client.query('DELETE FROM users WHERE email = $1', [EMAIL]);
        await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_mutation');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    await pool?.end();
  });

  it('inicia sesión y bloquea módulos restringidos por rol', async () => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel('Correo electrónico').fill(EMAIL);
    await page.getByLabel('Contraseña').fill('incorrecta');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.getByText('Credenciales inválidas').waitFor({ state: 'visible' });

    await page.getByLabel('Correo electrónico').fill(EMAIL);
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForURL('**/requerimientos');
    expect(page.url()).toMatch(/\/requerimientos$/);

    await page.goto(`${BASE_URL}/usuarios`);
    await page.waitForURL('**/dashboard');
    expect(page.url()).toMatch(/\/dashboard$/);
    const usuarios = await page.evaluate(async () => (await fetch('/api/usuarios')).status);
    expect(usuarios).toBe(403);
  });

  it('revisa el CV antes de confirmar y crear el candidato', async () => {
    await page.goto(`${BASE_URL}/importar`);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'browser-cv.pdf',
      mimeType: 'application/pdf',
      buffer: pdfSintetico(),
    });
    await page.getByLabel('Departamento destino *').selectOption(departamentoId);
    const previewButton = page.getByRole('button', { name: /Previsualizar/ });
    await previewButton.click();
    await page.getByText('Revisa los datos extraídos').waitFor({ state: 'visible' });
    await page.getByText(/todavía no se ha creado ningún candidato/).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Confirmar y crear candidatos' }).click();
    await page.getByText('Resultado de la importación').waitFor({ state: 'visible' });
    const resumenImportacion = await page.locator('body').innerText();
    expect(resumenImportacion).toContain('Candidato creado');

    const candidato = await pool.query<{ id: string }>(
      'SELECT id FROM candidatos WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      ['browser-cv@synthetic.test'],
    );
    const candidatoId = candidato.rows[0]?.id;
    if (candidatoId === undefined) throw new Error('No se creó el candidato browser sintético');

    const descarga = await page.evaluate(async (id) => {
      const listado = await fetch(`/api/candidatos/${id}/archivos`);
      const archivos = (await listado.json()) as Array<{ id: string }>;
      const archivo = archivos[0];
      if (archivo === undefined) return { listado: listado.status, descarga: 0, bytes: 0 };
      const respuesta = await fetch(`/api/candidatos/${id}/archivos/${archivo.id}/descarga`);
      const bytes = (await respuesta.arrayBuffer()).byteLength;
      return { listado: listado.status, descarga: respuesta.status, bytes };
    }, candidatoId);
    expect(descarga).toMatchObject({ listado: 200, descarga: 200 });
    expect(descarga.bytes).toBeGreaterThan(0);
    if (process.env.E2E_SKIP_FLOW === 'true') return;

    const creado = await page.evaluate(
      async ({ departamentoId, titulo }) => {
        const csrf = document.cookie
          .split('; ')
          .find((cookie) => cookie.startsWith('ats_csrf='))
          ?.split('=')[1];
        const response = await fetch('/api/requerimientos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
          body: JSON.stringify({
            identificacion: {
              titulo,
              jefatura: 'GESTION HUMANA',
              numeroPlazas: 1,
              urgencia: 'normal',
              modalidad: 'directa',
              departamentoId,
              ubicacion: 'Bogotá',
              fechaRequerida: '2030-01-01',
            },
            perfil: {
              perfilProfesional: 'Perfil browser sintético',
              experienciaRequerida: '1 año',
              nivelEducacion: 'Profesional',
            },
            conocimientos: { conocimientos: ['TypeScript'], habilidades: ['Comunicación'] },
            condiciones: {
              salarioMin: 1,
              salarioMax: 2,
              tipoContrato: 'Indefinido',
              jornada: 'Completa',
            },
            justificacion: { justificacion: 'Prueba E2E sintética' },
          }),
        });
        return (await response.json()) as { id?: string; statusCode?: number };
      },
      { departamentoId, titulo: TITULO_REQUERIMIENTO },
    );
    if (creado.id === undefined)
      throw new Error(`No se creó el requerimiento: ${JSON.stringify(creado)}`);
    requerimientoId = creado.id;

    const aprobado = await page.evaluate(async (id) => {
      const csrf = document.cookie
        .split('; ')
        .find((cookie) => cookie.startsWith('ats_csrf='))
        ?.split('=')[1];
      const response = await fetch(`/api/requerimientos/${id}/transiciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
        body: JSON.stringify({ destino: 'aprobado' }),
      });
      return response.status;
    }, requerimientoId);
    expect(aprobado).toBe(200);

    const activado = await page.evaluate(async (id) => {
      const csrf = document.cookie
        .split('; ')
        .find((cookie) => cookie.startsWith('ats_csrf='))
        ?.split('=')[1];
      const response = await fetch(`/api/requerimientos/${id}/transiciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
        body: JSON.stringify({ destino: 'en_proceso' }),
      });
      return response.status;
    }, requerimientoId);
    expect(activado).toBe(200);

    const conflicto = await page.evaluate(async (id) => {
      const csrf = document.cookie
        .split('; ')
        .find((cookie) => cookie.startsWith('ats_csrf='))
        ?.split('=')[1];
      const response = await fetch(`/api/requerimientos/${id}/transiciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
        body: JSON.stringify({ destino: 'en_proceso' }),
      });
      return response.status;
    }, requerimientoId);
    expect(conflicto).toBe(409);

    const postulacion = await page.evaluate(
      async ({ candidatoId, requerimientoId }) => {
        const csrf = document.cookie
          .split('; ')
          .find((cookie) => cookie.startsWith('ats_csrf='))
          ?.split('=')[1];
        const response = await fetch('/api/postulaciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
          body: JSON.stringify({ candidatoId, requerimientoId }),
        });
        return { status: response.status, body: (await response.json()) as { id?: string } };
      },
      { candidatoId, requerimientoId },
    );
    expect(postulacion.status).toBe(201);
    expect(postulacion.body.id).toBeDefined();

    const segundo = await page.evaluate(
      async ({ departamentoId, email }) => {
        const csrf = document.cookie
          .split('; ')
          .find((cookie) => cookie.startsWith('ats_csrf='))
          ?.split('=')[1];
        const response = await fetch('/api/candidatos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
          body: JSON.stringify({
            nombres: 'Candidato',
            apellidos: 'Browser Descarte',
            email,
            cedula: '987654321',
            departamentoId,
          }),
        });
        return (await response.json()) as { id?: string };
      },
      { departamentoId, email: EMAIL_DESCARTADO },
    );
    if (segundo.id === undefined) throw new Error('No se creó el segundo candidato sintético');
    const segundaPostulacion = await page.evaluate(
      async ({ candidatoId, requerimientoId }) => {
        const csrf = document.cookie
          .split('; ')
          .find((cookie) => cookie.startsWith('ats_csrf='))
          ?.split('=')[1];
        const response = await fetch('/api/postulaciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
          body: JSON.stringify({ candidatoId, requerimientoId }),
        });
        return response.status;
      },
      { candidatoId: segundo.id, requerimientoId },
    );
    expect(segundaPostulacion).toBe(201);

    await page.goto(`${BASE_URL}/requerimientos/${requerimientoId}/embudo`);
    const tarjeta = page.locator('article').filter({ hasText: 'Martha Browser Sintetica' });
    const fases = [
      'Validación de Antecedentes',
      'Entrevistas y Psicotécnicas',
      'Pruebas Proveedor Externo',
      'Contratación',
    ];
    for (const fase of fases) {
      const destino = page
        .getByRole('region', { name: `Columna ${fase}` })
        .locator('div')
        .last();
      const origenBox = await tarjeta.boundingBox();
      const destinoBox = await destino.boundingBox();
      if (origenBox === null || destinoBox === null) {
        throw new Error(`No se pudo ubicar la tarjeta o columna ${fase}`);
      }
      await page.mouse.move(origenBox.x + origenBox.width / 2, origenBox.y + 20);
      await page.mouse.down();
      await page.mouse.move(destinoBox.x + destinoBox.width / 2, destinoBox.y + 30, {
        steps: 12,
      });
      await page.mouse.up();
      await page.waitForTimeout(250);
    }
    await page.getByText('Contratado').waitFor({ state: 'visible' });

    const descarte = page.locator('article').filter({ hasText: 'Browser Descarte' });
    await descarte.getByRole('button', { name: 'Descartar' }).click();
    await page.getByLabel(/Motivo del descarte/).fill('No supera la evaluación sintética');
    await page.getByRole('dialog').getByRole('button', { name: 'Aceptar' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await descarte.waitFor({ state: 'detached' });
  });
});
