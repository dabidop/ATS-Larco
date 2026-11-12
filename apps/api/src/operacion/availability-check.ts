import { statfs } from 'node:fs/promises';
import { Pool } from 'pg';

export type AvailabilityOptions = {
  apiUrl: string;
  databaseUrl: string;
  uploadDir: string;
  backupDir: string;
  maxBackupAgeHours: number;
  minFreeBytes: number;
  fetcher?: typeof fetch;
  databaseCheck?: () => Promise<void>;
  fetchTimeoutMs?: number;
  backupMaxSkewHours?: number;
  now?: Date;
};

export type AvailabilityResult = {
  ok: boolean;
  checks: Record<'api' | 'database' | 'cvSpace' | 'backupFresh', boolean>;
  checkedAt: string;
};

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: URL,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('API health timeout'));
      }, timeoutMs);
    });
    return await Promise.race([fetcher(url, { signal: controller.signal }), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function checkAvailability(options: AvailabilityOptions): Promise<AvailabilityResult> {
  if (
    ![options.maxBackupAgeHours, options.minFreeBytes, options.backupMaxSkewHours ?? 1].every(
      Number.isFinite,
    ) ||
    options.maxBackupAgeHours <= 0 ||
    options.minFreeBytes < 0 ||
    (options.backupMaxSkewHours ?? 1) < 0
  ) {
    throw new Error('thresholds inválidos');
  }
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const databaseCheck =
    options.databaseCheck ??
    (async () => {
      const pool = new Pool({
        connectionString: options.databaseUrl,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      try {
        await pool.query('SELECT 1');
      } finally {
        await pool.end();
      }
    });
  const checks: AvailabilityResult['checks'] = {
    api: false,
    database: false,
    cvSpace: false,
    backupFresh: false,
  };
  {
    try {
      const response = await fetchWithTimeout(
        fetcher,
        new URL('/api/health/ready', options.apiUrl),
        options.fetchTimeoutMs ?? 5000,
      );
      checks.api = response.ok;
    } catch {
      checks.api = false;
    }
    try {
      await databaseCheck();
      checks.database = true;
    } catch {
      checks.database = false;
    }
    try {
      const fs = await statfs(options.uploadDir);
      checks.cvSpace = Number(fs.bavail) * Number(fs.bsize) >= options.minFreeBytes;
    } catch {
      checks.cvSpace = false;
    }
    try {
      const entries = await (
        await import('node:fs/promises')
      ).readdir(options.backupDir, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const info = await (
              await import('node:fs/promises')
            ).stat(`${options.backupDir}/${entry.name}`);
            return { name: entry.name.toLowerCase(), mtime: info.mtime.getTime() };
          }),
      );
      const latest = (items: typeof files) => items.sort((a, b) => b.mtime - a.mtime)[0];
      const pg = latest(
        files.filter((file) => file.name.endsWith('.dump') || file.name.endsWith('.sql')),
      );
      const cv = latest(
        files.filter(
          (file) =>
            file.name.endsWith('.tar') ||
            file.name.endsWith('.tar.gz') ||
            file.name.endsWith('.tgz'),
        ),
      );
      const age = options.maxBackupAgeHours * 3600000;
      const skew = (options.backupMaxSkewHours ?? 1) * 3600000;
      checks.backupFresh = Boolean(
        pg &&
        cv &&
        now.getTime() - pg.mtime <= age &&
        now.getTime() - cv.mtime <= age &&
        Math.abs(pg.mtime - cv.mtime) <= skew,
      );
    } catch {
      checks.backupFresh = false;
    }
  }
  return { ok: Object.values(checks).every(Boolean), checks, checkedAt: now.toISOString() };
}

async function main(): Promise<void> {
  const required = ['DATABASE_URL', 'API_URL', 'UPLOAD_DIR', 'BACKUP_DIR'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Faltan variables: ${missing.join(', ')}`);
  const maxBackupAgeHours = Number(process.env.MAX_BACKUP_AGE_HOURS ?? 24);
  const minFreeBytes = Number(process.env.MIN_CV_FREE_BYTES ?? 1);
  const backupMaxSkewHours = Number(process.env.BACKUP_MAX_SKEW_HOURS ?? 1);
  if (
    ![maxBackupAgeHours, minFreeBytes, backupMaxSkewHours].every(Number.isFinite) ||
    maxBackupAgeHours <= 0 ||
    minFreeBytes < 0 ||
    backupMaxSkewHours < 0
  )
    throw new Error('thresholds inválidos');
  const result = await checkAvailability({
    databaseUrl: process.env.DATABASE_URL!,
    apiUrl: process.env.API_URL!,
    uploadDir: process.env.UPLOAD_DIR!,
    backupDir: process.env.BACKUP_DIR!,
    maxBackupAgeHours,
    minFreeBytes,
    backupMaxSkewHours,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (
  process.argv[1]?.endsWith('availability-check.ts') ||
  process.argv[1]?.endsWith('availability-check.js')
)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
