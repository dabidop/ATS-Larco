import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

type Queryable = {
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type CvInventory = {
  generatedAt: string;
  cutoff: string;
  blobs: { total: number; orphaned: number; referenced: number; candidates: string[] };
  discarded: { candidates: number; rows: number; cutoff: string };
};

/** Read-only inventory. It intentionally has no delete operation. */
export async function inventoryCv(
  pool: Queryable,
  uploadDir: string,
  now = new Date(),
  options: { includeHashes?: boolean } = {},
): Promise<CvInventory> {
  const cutoffDate = new Date(now);
  cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() - 6);
  const blobs: Array<{ sha256: string; mtime: Date }> = [];
  try {
    for (const name of await readdir(resolve(uploadDir))) {
      if (!/^[0-9a-f]{64}$/.test(name)) continue;
      const info = await stat(resolve(uploadDir, name));
      if (info.isFile()) blobs.push({ sha256: name, mtime: info.mtime });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const referenced = await pool.query<{ sha256: string }>(
    'SELECT DISTINCT sha256 FROM archivos_cv WHERE sha256 = ANY($1::text[])',
    [blobs.map((blob) => blob.sha256)],
  );
  const refs = new Set(referenced.rows.map((row) => row.sha256));
  const orphaned = blobs.filter((blob) => !refs.has(blob.sha256) && blob.mtime <= cutoffDate);
  const discarded = await pool.query<{ candidates: string; rows: string }>(
    `SELECT count(DISTINCT p.candidato_id)::text AS candidates,
            count(ac.id)::text AS rows
       FROM postulaciones p
       LEFT JOIN archivos_cv ac ON ac.candidato_id = p.candidato_id
      WHERE p.estado = 'descartado'
        AND p.updated_at <= $1
        AND NOT EXISTS (
          SELECT 1 FROM postulaciones active
           WHERE active.candidato_id = p.candidato_id
             AND active.estado <> 'descartado'
        )`,
    [cutoffDate],
  );
  return {
    generatedAt: now.toISOString(),
    cutoff: cutoffDate.toISOString(),
    blobs: {
      total: blobs.length,
      orphaned: orphaned.length,
      referenced: refs.size,
      candidates: options.includeHashes ? orphaned.map((x) => x.sha256) : [],
    },
    discarded: {
      candidates: Number(discarded.rows[0]?.candidates ?? 0),
      rows: Number(discarded.rows[0]?.rows ?? 0),
      cutoff: cutoffDate.toISOString(),
    },
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const uploadDir = process.env.UPLOAD_DIR;
  if (!databaseUrl || !uploadDir) throw new Error('DATABASE_URL y UPLOAD_DIR son obligatorias');
  if (process.argv.includes('--delete'))
    throw new Error('Borrado no implementado: dry-run obligatorio');
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
  try {
    console.log(
      JSON.stringify(
        await inventoryCv(pool, uploadDir, new Date(), {
          includeHashes: process.env.CV_INVENTORY_SHOW_HASHES === 'true',
        }),
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('cv-inventory.ts') || process.argv[1]?.endsWith('cv-inventory.js')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
}
