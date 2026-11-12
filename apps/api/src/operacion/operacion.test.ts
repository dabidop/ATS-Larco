import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAvailability } from './availability-check';
import { inventoryCv } from './cv-inventory';

describe('operación sintética (solo lectura)', () => {
  it('inventaría huérfanos antiguos y descartados sin borrar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ats-cv-inventory-'));
    const old = 'a'.repeat(64);
    const referenced = 'b'.repeat(64);
    await writeFile(join(dir, old), 'old');
    await writeFile(join(dir, referenced), 'used');
    const date = new Date('2026-11-12T00:00:00Z');
    await utimes(join(dir, old), new Date('2025-01-01'), new Date('2025-01-01'));
    const queries: string[] = [];
    const pool = {
      query: async <T>(sql: string): Promise<{ rows: T[] }> => {
        queries.push(sql);
        if (sql.includes('DISTINCT sha256')) return { rows: [{ sha256: referenced } as T] };
        return { rows: [{ candidates: '1', rows: '1' } as T] };
      },
    };
    const result = await inventoryCv(pool, dir, date, { includeHashes: true });
    expect(result.blobs.candidates).toEqual([old]);
    expect(result.discarded).toMatchObject({ candidates: 1, rows: 1 });
    expect(queries.every((sql) => !sql.trimStart().startsWith('DELETE'))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('devuelve fallo cuando API, BD, disco y backup no están disponibles', async () => {
    const result = await checkAvailability({
      apiUrl: 'http://127.0.0.1:1',
      databaseUrl: 'postgres://invalid:invalid@127.0.0.1:1/no',
      uploadDir: join(tmpdir(), 'missing-cv'),
      backupDir: join(tmpdir(), 'missing-backup'),
      maxBackupAgeHours: 1,
      minFreeBytes: 1,
      fetcher: async () => {
        throw new Error('synthetic failure');
      },
      databaseCheck: async () => {
        throw new Error('synthetic db failure');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.checks).toEqual({
      api: false,
      database: false,
      cvSpace: false,
      backupFresh: false,
    });
  });

  it('reporta disponibilidad sintética correcta', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ats-availability-'));
    const upload = join(root, 'cv');
    const backup = join(root, 'backup');
    await mkdir(upload);
    await mkdir(backup);
    await writeFile(join(backup, 'synthetic.dump'), 'fixture');
    await writeFile(join(backup, 'synthetic.tar.gz'), 'fixture');
    const result = await checkAvailability({
      apiUrl: 'http://synthetic.test',
      databaseUrl: 'postgres://invalid:invalid@127.0.0.1:1/no',
      uploadDir: upload,
      backupDir: backup,
      maxBackupAgeHours: 1,
      minFreeBytes: 1,
      now: new Date(),
      fetcher: async () => new Response('{}', { status: 200 }),
      databaseCheck: async () => undefined,
    });
    expect(result.checks.api).toBe(true);
    expect(result.checks.cvSpace).toBe(true);
    expect(result.checks.backupFresh).toBe(true);
    expect(result.ok).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it('rechaza thresholds no numéricos o negativos', async () => {
    await expect(
      checkAvailability({
        apiUrl: 'http://synthetic.test',
        databaseUrl: 'postgres://unused',
        uploadDir: 'unused',
        backupDir: 'unused',
        maxBackupAgeHours: Number.NaN,
        minFreeBytes: 1,
      }),
    ).rejects.toThrow('thresholds inválidos');
  });

  it('marca API caída cuando el fetcher no coopera con abort', async () => {
    const started = Date.now();
    const result = await checkAvailability({
      apiUrl: 'http://synthetic.test',
      databaseUrl: 'postgres://unused',
      uploadDir: 'missing',
      backupDir: 'missing',
      maxBackupAgeHours: 1,
      minFreeBytes: 1,
      fetchTimeoutMs: 10,
      fetcher: async () => new Promise<Response>(() => undefined),
      databaseCheck: async () => {
        throw new Error('synthetic db failure');
      },
    });
    expect(result.checks.api).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
