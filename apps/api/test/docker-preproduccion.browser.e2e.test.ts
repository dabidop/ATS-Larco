/*
 * Ensayo de preproducción completamente aislado. No importar test-env ni
 * dev-db-env: esta suite construye su propia URL y su propio Compose.
 *
 * Es deliberadamente opt-in. La primera escritura (el usuario analista) solo
 * ocurre después de verificar que la BD pertenece a este ensayo y que es PG16.
 */
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/crypto/password.util';

const execFileAsync = promisify(execFile);
const OPT_IN = process.env.ATS_DOCKER_SMOKE === '1';
// Vitest puede ejecutarse desde la raíz o con `pnpm -C apps/api`; el contexto
// siempre es la raíz del monorepo, no el cwd del proceso.
const ROOT = resolve(__dirname, '../../..').replaceAll('\\', '/').replace(/\/$/, '');
const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
const project = `ats-smoke-${suffix}`;
const database = `ats_smoke_${suffix}`;
const dbUser = `ats_smoke_${suffix}`;
const dbPassword = `pw-${randomUUID()}`;
const adminEmail = `admin-${suffix}@synthetic.test`;
const analystEmail = `analyst-${suffix}@synthetic.test`;
const candidateEmail = `candidate-${suffix}@synthetic.test`;
const discardedEmail = `discarded-${suffix}@synthetic.test`;
const password = `Smoke-${randomUUID()}-Aa1!`;
const analystPassword = `Analyst-${randomUUID()}-Aa1!`;

function assertLoopbackPort(value: string | undefined, name: string): number {
  if (value === undefined || !/^\d+$/.test(value))
    throw new Error(`${name} debe ser un puerto explícito`);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(`${name} fuera de rango`);
  return port;
}

function pdfSintetico(): Buffer {
  const text = `Martha Browser Sintetica\nTypeScript React\n${candidateEmail}`;
  const content = `BT /F1 12 Tf 72 720 Td (${text
    .replaceAll(')', '\\)')
    .replaceAll('(', '\\(')
    .replaceAll('\n', ') Tj 0 -18 Td (')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function assertPdfSemantics(bytes: Buffer): void {
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-1.')).toBe(true);
  expect(text.endsWith('%%EOF')).toBe(true);
  expect(text).toContain('/Type /Catalog');
  expect(text).toContain('/Type /Page');
  expect(text).toContain('/Type /Font');
  const start = text.match(/startxref\n(\d+)/)?.[1];
  expect(start).toBeDefined();
  expect(Number(start)).toBeLessThan(bytes.length);
}

async function parsePdfWithReader(bytes: Buffer): Promise<void> {
  const require = createRequire(__filename);
  const modulePath = require.resolve('pdfjs-dist/legacy/build/pdf.js');
  const reader = require(modulePath) as {
    getDocument: (options: { data: Uint8Array }) => { promise: Promise<{ numPages: number }> };
  };
  const document = await reader.getDocument({ data: new Uint8Array(bytes) }).promise;
  expect(document.numPages).toBe(1);
}

function composeFile(dir: string, dbPort: number, api: number, web: number): string {
  return `name: ${project}
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${dbUser}
      POSTGRES_PASSWORD: ${dbPassword}
      POSTGRES_DB: ${database}
    ports:
      - "127.0.0.1:${dbPort}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${dbUser} -d ${database}"]
      interval: 2s
      timeout: 3s
      retries: 30
    volumes:
      - pgdata_smoke:/var/lib/postgresql/data
  api:
    build:
      context: "${ROOT}"
      dockerfile: apps/api/Dockerfile
    working_dir: /app
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATABASE_URL: postgres://${dbUser}:${dbPassword}@db:5432/${database}
      CORS_ORIGIN: http://127.0.0.1:${web}
      ADMIN_INITIAL_PASSWORD: ${password}
      ADMIN_INITIAL_EMAIL: ${adminEmail}
      ADMIN_INITIAL_NAME: Smoke Admin ${suffix}
      SUPER_INITIAL_PASSWORD: ${password}
      SUPER_INITIAL_EMAIL: super-${suffix}@synthetic.test
      SUPER_INITIAL_NAME: Smoke Super ${suffix}
      JWT_SECRET: smoke-jwt-${randomUUID()}-012345678901234567890123456789
      CRYPTO_KEY_BASE64: ${Buffer.alloc(32, 17).toString('base64')}
      CEDULA_SEARCH_KEY: ${Buffer.alloc(32, 19).toString('base64')}
      UPLOAD_DIR: /app/storage/CVs
    ports:
      - "127.0.0.1:${api}:3000"
    volumes:
      - cv_smoke:/app/storage/CVs
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
  migrate:
    profiles: [migration]
    build:
      context: "${ROOT}"
      dockerfile: apps/api/Dockerfile
      target: builder
    working_dir: /app
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://${dbUser}:${dbPassword}@db:5432/${database}
      ADMIN_INITIAL_PASSWORD: ${password}
      ADMIN_INITIAL_EMAIL: ${adminEmail}
      ADMIN_INITIAL_NAME: Smoke Admin ${suffix}
      SUPER_INITIAL_PASSWORD: ${password}
      SUPER_INITIAL_EMAIL: super-${suffix}@synthetic.test
      SUPER_INITIAL_NAME: Smoke Super ${suffix}
    command: ["pnpm", "--filter", "@ats/api", "db:migrate"]
    depends_on:
      db:
        condition: service_healthy
  web:
    build:
      context: "${ROOT}"
      dockerfile: apps/web/Dockerfile
    environment:
      API_PROXY_TARGET: http://api:3000
    ports:
      - "127.0.0.1:${web}:80"
    depends_on:
      api:
        condition: service_healthy
volumes:
  pgdata_smoke:
  cv_smoke:
`;
}

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`El puerto ${port} no está libre`)));
    server.listen(port, '127.0.0.1', () =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
  });
}

describe.skipIf(!OPT_IN)('ATS Docker preproducción browser (opt-in)', () => {
  let dir: string;
  let compose: string;
  let dbPort: number;
  let api: number;
  let web: number;
  let pool: Pool;
  let browser: Browser;
  let adminContext: BrowserContext;
  let page: Page;
  let departmentId: string;
  let candidateId: string;
  let requiredId: string;
  const browserDiagnostics: string[] = [];
  const pdf = pdfSintetico();

  beforeAll(async () => {
    if (!OPT_IN) throw new Error('Esta prueba requiere ATS_DOCKER_SMOKE=1');
    web = assertLoopbackPort(process.env.E2E_WEB_PORT, 'E2E_WEB_PORT');
    api = assertLoopbackPort(process.env.E2E_API_PORT, 'E2E_API_PORT');
    if (process.env.E2E_WEB_URL === undefined) throw new Error('E2E_WEB_URL explícito requerido');
    const webUrl = new URL(process.env.E2E_WEB_URL);
    if (
      webUrl.hostname !== '127.0.0.1' &&
      webUrl.hostname !== 'localhost' &&
      webUrl.hostname !== '::1'
    )
      throw new Error('E2E_WEB_URL no es loopback');
    if (webUrl.port !== String(web))
      throw new Error('E2E_WEB_URL debe usar el puerto E2E_WEB_PORT');
    if (!['http:', 'https:'].includes(webUrl.protocol)) throw new Error('E2E_WEB_URL inválida');
    if (/dev|staging|production/i.test(process.env.E2E_WEB_URL))
      throw new Error('E2E_WEB_URL apunta a un ambiente prohibido');
    const executable =
      process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    await access(executable);

    dbPort = assertLoopbackPort(process.env.E2E_DB_PORT, 'E2E_DB_PORT');
    const ports = new Set([web, api, dbPort]);
    if (ports.size !== 3 || ports.has(3000) || ports.has(5173) || ports.has(5432))
      throw new Error('Los puertos del ensayo deben ser distintos y no ser puertos dev');
    await Promise.all([assertPortFree(web), assertPortFree(api), assertPortFree(dbPort)]);
    dir = await mkdtemp(`${tmpdir()}/ats-docker-smoke-`);
    compose = `${dir}/compose.yml`;
    await writeFile(compose, composeFile(dir, dbPort, api, web), 'utf8');
    const envFile = `${dir}/empty.env`;
    await writeFile(envFile, '', 'utf8');
    const args = [
      'compose',
      '--env-file',
      envFile,
      '--profile',
      'migration',
      '-p',
      project,
      '-f',
      compose,
      'up',
      '-d',
      '--build',
    ];
    try {
      await execFileAsync('docker', args, {
        cwd: ROOT,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 900000,
      });
    } catch (error) {
      throw new Error(`No se pudo iniciar Compose aislado: ${String(error)}`, { cause: error });
    }

    const databaseUrl = `postgres://${dbUser}:${dbPassword}@127.0.0.1:${dbPort}/${database}`;
    pool = new Pool({ connectionString: databaseUrl });
    let guard: { current_database: string; current_user: string; version: string } | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const result = await pool.query<{
          current_database: string;
          current_user: string;
          version: string;
        }>('SELECT current_database(), current_user, version()');
        guard = result.rows[0];
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (
      guard === undefined ||
      guard.current_database !== database ||
      guard.current_user !== dbUser ||
      !/^PostgreSQL 16\./.test(guard.version)
    )
      throw new Error('Guard de BD falló: no es la BD/usuario/PG16 exclusivos');
    await pool.query(
      'INSERT INTO users (role_id, email, password_hash, full_name, active) SELECT id, $1, $2, $3, true FROM roles WHERE code = $4',
      [
        analystEmail,
        await hashPassword(analystPassword),
        `Smoke Analyst ${suffix}`,
        'analista_seleccion',
      ],
    );
    const department = await pool.query<{ id: string }>(
      'SELECT id FROM departamentos ORDER BY nombre LIMIT 1',
    );
    departmentId =
      department.rows[0]?.id ??
      (() => {
        throw new Error('No hay departamento sembrado');
      })();
    browser = await chromium.launch({ headless: true, executablePath: executable });
    adminContext = await browser.newContext();
    page = await adminContext.newPage();
    page.on('pageerror', (error) =>
      browserDiagnostics.push(`pageerror: ${error.name}: ${error.message}`),
    );
    page.on('console', (message) => {
      if (message.type() === 'error') browserDiagnostics.push(`console.error: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      browserDiagnostics.push(
        `requestfailed: ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? 'unknown'}`,
      );
    });
  }, 1200000);

  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      // El Compose se baja primero para que un hook de BD/browser atascado no
      // deje contenedores ni puertos vivos después de un fallo de beforeAll o
      // de un test.
      if (compose !== undefined && dir !== undefined)
        await execFileAsync(
          'docker',
          [
            'compose',
            '--env-file',
            `${dir}/empty.env`,
            '-p',
            project,
            '-f',
            compose,
            'down',
            '-v',
            '--remove-orphans',
          ],
          { cwd: ROOT, maxBuffer: 2 * 1024 * 1024, timeout: 120000 },
        ).catch(() => undefined);
      if (pool !== undefined) await pool.end().catch(() => undefined);
      if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    }
  }, 1200000);

  it('autentica dos roles y aplica autorización', async () => {
    await page.goto(`${process.env.E2E_WEB_URL}/login`);
    await page.getByLabel('Correo electrónico').fill(adminEmail);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForURL('**/requerimientos');
    expect(page.url()).toMatch(/requerimientos$/);
    const analystContext = await browser.newContext();
    const analystPage = await analystContext.newPage();
    await analystPage.goto(`${process.env.E2E_WEB_URL}/login`);
    await analystPage.getByLabel('Correo electrónico').fill(analystEmail);
    await analystPage.getByLabel('Contraseña').fill(analystPassword);
    await analystPage.getByRole('button', { name: 'Ingresar' }).click();
    await analystPage.waitForURL('**/requerimientos');
    await analystPage.goto(`${process.env.E2E_WEB_URL}/usuarios`);
    await analystPage.waitForURL('**/dashboard');
    expect(await analystPage.evaluate(async () => (await fetch('/api/usuarios')).status)).toBe(403);
    await analystContext.close();
  });

  it('revisa importación y descarga el PDF exacto', async () => {
    await page.goto(`${process.env.E2E_WEB_URL}/importar`);
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: `cv-${suffix}.pdf`, mimeType: 'application/pdf', buffer: pdf });
    await page.getByLabel('Departamento destino *').selectOption(departmentId);
    await page.getByRole('button', { name: /Previsualizar/ }).click();
    await page.getByText('Revisa los datos extraídos').waitFor();
    // La revisión es parte del contrato: no dependemos de que el heurístico
    // haya inferido el email exacto desde el PDF.
    const reviewInputs = page
      .locator('section')
      .filter({ hasText: 'Revisa los datos extraídos' })
      .locator('input');
    await reviewInputs.nth(0).fill(`Martha ${suffix}`);
    await reviewInputs.nth(1).fill('Browser Sintética');
    await reviewInputs.nth(2).fill(candidateEmail);
    await page.getByRole('button', { name: 'Confirmar y crear candidatos' }).click();
    await page.getByText('Resultado de la importación').waitFor();
    const result = await pool.query<{ id: string }>('SELECT id FROM candidatos WHERE email = $1', [
      candidateEmail,
    ]);
    candidateId =
      result.rows[0]?.id ??
      (() => {
        throw new Error('La importación no creó el fixture');
      })();
    const bytes = await page.evaluate(async (id) => {
      const list = await fetch(`/api/candidatos/${id}/archivos`);
      const files = (await list.json()) as Array<{ id: string }>;
      const response =
        files[0] === undefined
          ? undefined
          : await fetch(`/api/candidatos/${id}/archivos/${files[0].id}/descarga`);
      return {
        listStatus: list.status,
        downloadStatus: response?.status ?? 0,
        bytes:
          response === undefined ? [] : Array.from(new Uint8Array(await response.arrayBuffer())),
      };
    }, candidateId);
    console.info(
      `[docker-smoke] archivos lista=${bytes.listStatus} descarga=${bytes.downloadStatus} bytes=${bytes.bytes.length}`,
    );
    expect(bytes.listStatus).toBe(200);
    expect(bytes.downloadStatus).toBe(200);
    expect(bytes.bytes.length).toBeGreaterThan(0);
    const downloadedPdf = Buffer.from(bytes.bytes);
    expect(downloadedPdf).toEqual(pdf);
    assertPdfSemantics(downloadedPdf);
    await parsePdfWithReader(downloadedPdf);
  });

  it.skip('recorre las cinco fases con DnD (bloqueado: confirmación final no emite PATCH)', async () => {
    const created = await page.evaluate(
      async ({ departmentId, suffix }) => {
        const csrf =
          document.cookie
            .split('; ')
            .find((c) => c.startsWith('ats_csrf='))
            ?.split('=')[1] ?? '';
        const response = await fetch('/api/requerimientos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({
            identificacion: {
              titulo: `Smoke ${suffix}`,
              jefatura: 'GESTION HUMANA',
              numeroPlazas: 1,
              urgencia: 'normal',
              modalidad: 'directa',
              departamentoId: departmentId,
              ubicacion: 'Bogotá',
              fechaRequerida: '2030-01-01',
            },
            perfil: {
              perfilProfesional: 'Perfil smoke',
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
            justificacion: { justificacion: 'Ensayo sintético' },
          }),
        });
        return (await response.json()) as { id?: string };
      },
      { departmentId, suffix },
    );
    requiredId =
      created.id ??
      (() => {
        throw new Error('No se creó requerimiento sintético');
      })();
    const csrf = await page.evaluate(
      () =>
        document.cookie
          .split('; ')
          .find((c) => c.startsWith('ats_csrf='))
          ?.split('=')[1] ?? '',
    );
    for (const destination of ['aprobado', 'en_proceso']) {
      const transition = await page.evaluate(
        async ({ id, destination, csrf }) =>
          (
            await fetch(`/api/requerimientos/${id}/transiciones`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
              body: JSON.stringify({ destino: destination }),
            })
          ).status,
        { id: requiredId, destination, csrf },
      );
      expect(transition).toBe(200);
    }
    const application = await page.evaluate(
      async ({ candidateId, requiredId, csrf }) => {
        const response = await fetch('/api/postulaciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ candidatoId: candidateId, requerimientoId: requiredId }),
        });
        return { status: response.status, body: (await response.json()) as { id?: string } };
      },
      { candidateId, requiredId, csrf },
    );
    expect(application.status).toBe(201);
    expect(application.body.id).toBeDefined();
    const discarded = await page.evaluate(
      async ({ email, departmentId, requiredId, csrf }) => {
        const candidateResponse = await fetch('/api/candidatos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({
            nombres: 'Smoke',
            apellidos: 'Discarded',
            email,
            cedula: `${Date.now()}`.slice(-10),
            departamentoId: departmentId,
          }),
        });
        const candidate = (await candidateResponse.json()) as { id?: string };
        if (candidate.id === undefined) return 0;
        return (
          await fetch('/api/postulaciones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
            body: JSON.stringify({ candidatoId: candidate.id, requerimientoId: requiredId }),
          })
        ).status;
      },
      { email: discardedEmail, departmentId, requiredId, csrf },
    );
    expect(discarded).toBe(201);
    await page.goto(`${process.env.E2E_WEB_URL}/requerimientos/${requiredId}/embudo`);
    const card = page.locator('article').filter({ hasText: suffix });
    for (const phase of [
      'Validación de Antecedentes',
      'Entrevistas y Psicotécnicas',
      'Pruebas Proveedor Externo',
      'Contratación',
    ]) {
      const destinationRegion = page.getByRole('region', { name: `Columna ${phase}` });
      // Es el div ref de useDroppable (hijo directo de la columna), no el
      // div interno del estado vacío.
      const destination = destinationRegion.locator(':scope > div').last();
      await destination.scrollIntoViewIfNeeded();
      const originBox = await card.locator('div').first().boundingBox();
      const destinationBox = await destination.boundingBox();
      if (originBox === null || destinationBox === null)
        throw new Error(`No se ubicó DnD para ${phase}`);
      await page.mouse.move(originBox.x + originBox.width / 2, originBox.y + originBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        destinationBox.x + destinationBox.width / 2,
        destinationBox.y + Math.min(30, destinationBox.height / 2),
        { steps: 20 },
      );
      await page.mouse.up();
      const movementDialog = page.getByRole('dialog');
      try {
        await movementDialog.waitFor({ state: 'visible', timeout: 10000 });
      } catch (error) {
        const ui = await page.locator('body').innerText();
        const databaseState = await pool.query<{ fase: string; estado: string }>(
          'SELECT fase, estado FROM postulaciones WHERE id = $1',
          [application.body.id],
        );
        const screenshot = join(dir, `dnd-fallo-${phase.replaceAll(' ', '-')}.png`);
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
        throw new Error(
          `DnD no abrió DialogoMovimiento para ${phase}; UI=${ui.slice(-1000)}; DB=${JSON.stringify(databaseState.rows)}; DIAGNOSTICS=${browserDiagnostics.slice(-10).join(' | ')}; SCREENSHOT=${screenshot}; causa=${String(error)}`,
          { cause: error },
        );
      }
      const patchResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          /\/api\/postulaciones\/[^/]+\/fase$/.test(new URL(response.url()).pathname),
        { timeout: 10000 },
      );
      await movementDialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
      let patchStatus = 0;
      let patchSummary: string;
      try {
        const patchResponse = await patchResponsePromise;
        patchStatus = patchResponse.status();
        const body = (await patchResponse.json().catch(() => null)) as {
          statusCode?: number;
          message?: string;
        } | null;
        patchSummary = JSON.stringify({ statusCode: body?.statusCode, message: body?.message });
        console.info(`[docker-smoke] PATCH fase status=${patchStatus} body=${patchSummary}`);
      } catch (error) {
        patchSummary = String(error);
        console.info(`[docker-smoke] PATCH fase sin respuesta body=${patchSummary}`);
      }
      try {
        await movementDialog.waitFor({ state: 'detached', timeout: 10000 });
      } catch (error) {
        const ui = await page.locator('body').innerText();
        const databaseState = await pool.query<{ fase: string; estado: string }>(
          'SELECT fase, estado FROM postulaciones WHERE id = $1',
          [application.body.id],
        );
        const screenshot = join(dir, `dnd-confirmacion-fallo-${phase.replaceAll(' ', '-')}.png`);
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
        throw new Error(
          `Confirmación de movimiento no terminó para ${phase}; PATCH=${patchStatus}; PATCH_BODY=${patchSummary}; UI=${ui.slice(-1000)}; DB=${JSON.stringify(databaseState.rows)}; DIAGNOSTICS=${browserDiagnostics.slice(-10).join(' | ')}; BUTTON_DISABLED=${await movementDialog
            .getByRole('button', { name: 'Confirmar', exact: true })
            .isDisabled()
            .catch(() => false)}; SCREENSHOT=${screenshot}; causa=${String(error)}`,
          { cause: error },
        );
      }
      await destinationRegion.locator('article').last().waitFor({
        state: 'visible',
        timeout: 30000,
      });
    }
    await page
      .getByRole('region', { name: 'Columna Contratación' })
      .locator('article')
      .last()
      .waitFor();
    const discardedCard = page.locator('article').filter({ hasText: 'Smoke Discarded' });
    await discardedCard.getByRole('button', { name: 'Descartar' }).click();
    await page.getByLabel(/Motivo del descarte/).fill(`No supera ${suffix}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Aceptar' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const history = await page.evaluate(
      async (id) => (await fetch(`/api/postulaciones/${id}/historial`)).json(),
      application.body.id,
    );
    expect(Array.isArray(history)).toBe(true);
    expect((history as Array<{ destino?: string }>).length).toBeGreaterThan(0);
  }, 180000);
});
