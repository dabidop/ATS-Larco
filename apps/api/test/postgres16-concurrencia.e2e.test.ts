/**
 * Verificación de carreras contra PostgreSQL real (no dobles de Pool).
 *
 * Esta suite no carga .env ni proporciona DATABASE_URL por defecto. Solo se
 * ejecuta cuando ATS_INTEGRATION_PG16=1 y rechaza explícitamente destinos de
 * desarrollo conocidos. El invocador debe crear una BD efímera y un UPLOAD_DIR
 * efímero antes de lanzarla.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { ArchivosCvService } from '../src/modules/uploads/archivos-cv.service';
import { AlmacenamientoService } from '../src/modules/uploads/almacenamiento.service';
import { EntrevistasService } from '../src/modules/entrevistas/entrevistas.service';

const habilitada = process.env.ATS_INTEGRATION_PG16 === '1';
const url = process.env.DATABASE_URL;
const dbToken = process.env.ATS_INTEGRATION_DB_TOKEN;

function guardDeEntorno(): void {
  if (!habilitada) throw new Error('Use ATS_INTEGRATION_PG16=1 para ejecutar esta suite');
  if (!url) throw new Error('Suite bloqueada: falta DATABASE_URL efímera');
  if (dbToken !== 'pg16-ephemeral') {
    throw new Error('Suite bloqueada: falta ATS_INTEGRATION_DB_TOKEN=pg16-ephemeral');
  }
}

const suite = habilitada ? describe : describe.skip;

async function esperar<T>(promesa: Promise<T>, etiqueta: string): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<T>((_, reject) => {
        temporizador = setTimeout(() => reject(new Error(`Timeout esperando ${etiqueta}`)), 5000);
      }),
    ]);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }
}

suite('PostgreSQL 16: carreras C4/C9 con FS temporal', () => {
  let pool: Pool;
  let database: {
    pool: Pool;
    query: Pool['query'];
    withTransaction: (fn: (c: PoolClient) => Promise<unknown>) => Promise<unknown>;
  };
  let userId: string;
  let departmentId: string;
  const requestIds: string[] = [];
  let storage: AlmacenamientoService;
  let files: ArchivosCvService;
  let interviews: EntrevistasService;
  const createdCandidates: string[] = [];
  const createdPostulations: string[] = [];
  const createdInterviews: string[] = [];
  let fixtureDir: string;

  beforeAll(async () => {
    guardDeEntorno();
    fixtureDir = await mkdtemp(join(tmpdir(), 'ats-pg16-test-'));
    pool = new Pool({ connectionString: url, max: 8 });
    const identity = await pool.query<{ database: string; user: string; version: string }>(
      'SELECT current_database() AS database, current_user AS user, version() AS version',
    );
    const dbIdentity = identity.rows[0];
    if (
      dbIdentity === undefined ||
      !/^ats_pg16_test_[a-z0-9_]+$/i.test(dbIdentity.database) ||
      !/^ats_test(?:_[a-z0-9_]+)?$/i.test(dbIdentity.user) ||
      !dbIdentity.version.includes('PostgreSQL 16')
    ) {
      throw new Error(
        'Suite bloqueada: DB/usuario/version no corresponden a PostgreSQL 16 sintético',
      );
    }
    database = {
      pool,
      query: pool.query.bind(pool),
      withTransaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      },
    };
    const user = await pool.query<{ id: string }>('SELECT id FROM users ORDER BY id LIMIT 1');
    const department = await pool.query<{ id: string }>(
      'SELECT id FROM departamentos ORDER BY id LIMIT 1',
    );
    if (!user.rows[0] || !department.rows[0])
      throw new Error('La BD efímera no tiene seed de usuario/departamento');
    userId = user.rows[0].id;
    departmentId = department.rows[0].id;
    const config = { getOrThrow: (key: string) => (key === 'UPLOAD_DIR' ? fixtureDir : undefined) };
    storage = new AlmacenamientoService(config as never);
    files = new ArchivosCvService(database as never, storage);
    interviews = new EntrevistasService(database as never);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool
      .query('DELETE FROM entrevistas WHERE id = ANY($1::uuid[])', [createdInterviews])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM postulaciones WHERE id = ANY($1::uuid[])', [createdPostulations])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM candidatos WHERE id = ANY($1::uuid[])', [createdCandidates])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM requerimientos WHERE id = ANY($1::uuid[])', [requestIds])
      .catch(() => undefined);
    await pool.end();
    await rm(fixtureDir, { recursive: true, force: true });
  });

  async function candidate(label: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO candidatos (nombres, apellidos, email, cedula_cifrada, cedula_hash, departamento_id, created_by)
       VALUES ($1, $2, $3, 'v1:synthetic', $4, $5, $6) RETURNING id`,
      [
        label,
        'PG16',
        `${randomUUID()}@synthetic.test`,
        createHash('sha256').update(randomUUID()).digest('hex'),
        departmentId,
        userId,
      ],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error('No se creó el candidato sintético');
    createdCandidates.push(id);
    return id;
  }

  async function postulation(
    candidateId: string,
    estado: 'activa' | 'descartado',
    fase = 'entrevistas',
  ): Promise<string> {
    const requestId = requestIds.at(-1);
    if (requestId === undefined) throw new Error('No hay requerimiento sintético vigente');
    const row = await pool.query<{ id: string }>(
      `INSERT INTO postulaciones (candidato_id, requerimiento_id, fase, estado, motivo_descarte, created_by)
       VALUES ($1, $2, $3, $4::estado_postulacion, CASE WHEN $4::text = 'descartado' THEN 'fixture' ELSE NULL END, $5) RETURNING id`,
      [candidateId, requestId, fase, estado, userId],
    );
    const id = row.rows[0]?.id;
    if (id === undefined) throw new Error('No se creó la postulación sintética');
    createdPostulations.push(id);
    return id;
  }

  async function newRequest(): Promise<void> {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO requerimientos
       (code, estado, jefatura, titulo, numero_plazas, perfil_profesional, experiencia_requerida,
        nivel_educacion, conocimientos, habilidades, salario_min, salario_max, tipo_contrato, jornada,
        departamento_id, ubicacion, fecha_requerida, justificacion, modalidad, urgencia, created_by)
       VALUES ($1, 'en_proceso', 'PG16', 'Fixture', 10, 'Fixture', 'N/A', 'Profesional', ARRAY['SQL'], ARRAY['PG'],
        1, 2, 'Indefinido', 'Diurna', $2, 'Remoto', CURRENT_DATE, 'Fixture', 'directa', 'normal', $3) RETURNING id`,
      [`REQ-2026-${randomInt(100000, 999999)}`, departmentId, userId],
    );
    const id = row.rows[0]?.id;
    if (id === undefined) throw new Error('No se creó el requerimiento sintético');
    requestIds.push(id);
  }

  it('C4 serializa retención/subida en ambos órdenes y conserva el blob compartido', async () => {
    const bytes = Buffer.from('%PDF-1.7\nsynthetic shared blob', 'latin1');
    const sha = createHash('sha256').update(bytes).digest('hex');

    for (const orden of ['retencion-primero', 'subida-primero'] as const) {
      await newRequest();
      const descartado = await candidate(`retencion-${orden}`);
      const compartido = await candidate(`compartido-${orden}`);
      const nuevo = await candidate(`subida-${orden}`);
      await postulation(descartado, 'descartado');
      await postulation(compartido, 'activa');
      await postulation(nuevo, 'activa');
      await files.subir(descartado, { originalname: 'retained.pdf', buffer: bytes }, userId);
      await files.subir(compartido, { originalname: 'shared.pdf', buffer: bytes }, userId);
      const old = await pool.query<{ sha256: string }>(
        'SELECT sha256 FROM archivos_cv WHERE candidato_id = $1',
        [compartido],
      );
      expect(old.rows[0]?.sha256).toBe(sha);

      let liberarSubida!: () => void;
      let guardarIniciado!: () => void;
      const bloqueadorSubida = new Promise<void>((resolve) => {
        liberarSubida = resolve;
      });
      const subidaLista = new Promise<void>((resolve) => {
        guardarIniciado = resolve;
      });
      const almacenamientoBloqueado = {
        guardar: async (buffer: Buffer) => {
          guardarIniciado();
          await bloqueadorSubida;
          return storage.guardar(buffer);
        },
        retirar: storage.retirar.bind(storage),
        existe: storage.existe.bind(storage),
        leer: storage.leer.bind(storage),
        listarBlobs: storage.listarBlobs.bind(storage),
      };
      const subidaServicio = new ArchivosCvService(
        database as never,
        almacenamientoBloqueado as never,
      );
      let purge: Promise<unknown>;
      let upload: Promise<unknown>;
      if (orden === 'subida-primero') {
        upload = subidaServicio.subir(nuevo, { originalname: 'same.pdf', buffer: bytes }, userId);
        try {
          await esperar(subidaLista, 'lock de subida'); // guardar solo se alcanza tras adquirir el lock PG.
          purge = files.retirarCvDescartadosAntesDe(new Date(Date.now() + 60_000));
        } finally {
          liberarSubida();
        }
      } else {
        let retencionTieneLock!: () => void;
        const lockAdquirido = new Promise<void>((resolve) => {
          retencionTieneLock = resolve;
        });
        const dbRetencion = {
          ...database,
          pool: {
            ...pool,
            connect: async () => {
              const client = await pool.connect();
              return new Proxy(client, {
                get(target, property, receiver) {
                  if (property === 'query') {
                    return async (sql: string, params?: unknown[]) => {
                      const result = await target.query(sql, params);
                      if (sql.startsWith('SELECT pg_advisory_lock')) retencionTieneLock();
                      return result;
                    };
                  }
                  return Reflect.get(target, property, receiver);
                },
              }) as PoolClient;
            },
          } as never,
        };
        const retencionServicio = new ArchivosCvService(dbRetencion as never, storage as never);
        purge = retencionServicio.retirarCvDescartadosAntesDe(new Date(Date.now() + 60_000));
        // La señal se emite desde la sesión que obtuvo el advisory lock real.
        try {
          await esperar(lockAdquirido, 'lock de retención');
          upload = subidaServicio.subir(nuevo, { originalname: 'same.pdf', buffer: bytes }, userId);
        } finally {
          liberarSubida();
        }
      }
      const resultados = await Promise.allSettled([purge, upload]);
      expect(resultados[0].status).toBe('fulfilled');
      expect(resultados[1].status).toBe('fulfilled');

      const rows = await pool.query<{ candidato_id: string; sha256: string }>(
        'SELECT candidato_id, sha256 FROM archivos_cv WHERE sha256 = $1',
        [sha],
      );
      expect(rows.rows.map((r) => r.candidato_id)).toEqual(
        expect.arrayContaining([compartido, nuevo]),
      );
      expect(await stat(join(fixtureDir, sha))).toBeTruthy();
      // La fila compartida y la nueva fila apuntan al mismo blob que acaba de
      // verificarse en FS; no hay ninguna fila cuyo blob haya sido retirado.
      expect(rows.rows.every((row) => row.sha256 === sha)).toBe(true);
    }
  });

  it.each([
    ['descartar', 'terminal-primero'],
    ['descartar', 'entrevista-primero'],
    ['contratar', 'terminal-primero'],
    ['contratar', 'entrevista-primero'],
  ] as const)('C9 %s (%s) serializa agenda y desenlace terminal', async (terminal, orden) => {
    await newRequest();
    const candidateId = await candidate(`entrevista-${terminal}`);
    const postulationId = await postulation(
      candidateId,
      'activa',
      terminal === 'contratar' ? 'proveedor_externo' : 'entrevistas',
    );
    await expect(
      interviews.crear({ postulacionId: randomUUID(), fecha: '2026-11-12', tipo: 'PG16' }, userId),
    ).rejects.toMatchObject({ status: 404 });

    const terminalizar = async (): Promise<void> => {
      const lock = await pool.connect();
      try {
        await lock.query('BEGIN');
        await lock.query('SELECT id FROM postulaciones WHERE id = $1 FOR UPDATE', [postulationId]);
        await lock.query(
          "UPDATE postulaciones SET estado = $1::estado_postulacion, motivo_descarte = CASE WHEN $1::text = 'descartado' THEN 'race' ELSE NULL END, fase = CASE WHEN $1::text = 'contratado' THEN 'contratacion' ELSE fase END WHERE id = $2",
          [terminal === 'descartar' ? 'descartado' : 'contratado', postulationId],
        );
        await lock.query('COMMIT');
      } catch (error) {
        await lock.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        lock.release();
      }
    };

    if (orden === 'terminal-primero') {
      const lock = await pool.connect();
      let waitingInterview: Promise<unknown>;
      try {
        await lock.query('BEGIN');
        await lock.query('SELECT id FROM postulaciones WHERE id = $1 FOR UPDATE', [postulationId]);
        waitingInterview = interviews.crear(
          { postulacionId: postulationId, fecha: '2026-11-12', tipo: 'PG16' },
          userId,
        );
        await new Promise((resolve) => setImmediate(resolve));
        await lock.query(
          "UPDATE postulaciones SET estado = $1::estado_postulacion, motivo_descarte = CASE WHEN $1::text = 'descartado' THEN 'race' ELSE NULL END, fase = CASE WHEN $1::text = 'contratado' THEN 'contratacion' ELSE fase END WHERE id = $2",
          [terminal === 'descartar' ? 'descartado' : 'contratado', postulationId],
        );
        await lock.query('COMMIT');
      } catch (error) {
        await lock.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        lock.release();
      }
      await expect(waitingInterview).rejects.toMatchObject({ status: 409 });
    } else {
      let liberar!: () => void;
      let bloqueo!: () => void;
      const entrevistaTieneLock = new Promise<void>((resolve) => {
        bloqueo = resolve;
      });
      const dejarContinuar = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      const dbOrdenado = {
        ...database,
        withTransaction: async (fn: (client: PoolClient) => Promise<unknown>) => {
          const client = await pool.connect();
          const envuelto = new Proxy(client, {
            get(target, property, receiver) {
              if (property === 'query') {
                return async (sql: string, params?: unknown[]) => {
                  const result = await target.query(sql, params);
                  if (
                    sql.includes('SELECT estado FROM postulaciones') &&
                    sql.includes('FOR UPDATE')
                  ) {
                    bloqueo();
                    await dejarContinuar;
                  }
                  return result;
                };
              }
              return Reflect.get(target, property, receiver);
            },
          }) as PoolClient;
          try {
            await client.query('BEGIN');
            const result = await fn(envuelto);
            await client.query('COMMIT');
            return result;
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        },
      };
      const entrevistaOrdenada = new EntrevistasService(dbOrdenado as never);
      const entrevista = entrevistaOrdenada.crear(
        { postulacionId: postulationId, fecha: '2026-11-12', tipo: 'PG16' },
        userId,
      );
      await esperar(entrevistaTieneLock, 'lock de entrevista');
      const terminal = terminalizar();
      liberar();
      await expect(entrevista).resolves.toMatchObject({ postulacionId: postulationId });
      await expect(terminal).resolves.toBeUndefined();
    }
  });
});
