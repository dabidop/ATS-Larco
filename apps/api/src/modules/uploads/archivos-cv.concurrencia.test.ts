import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { ArchivosCvService, type ArchivoSubido } from './archivos-cv.service';

/**
 * Simula únicamente la semántica relevante de PostgreSQL: el lock de purga
 * es de sesión y el de subida es transaccional, ambos con la misma clave.
 * No conecta a ninguna BD (y por tanto no puede tocar la BD de desarrollo).
 */
class AdvisoryLockDoble {
  private propietario: string | undefined;
  private esperando: Array<() => void> = [];

  async adquirir(propietario: string): Promise<void> {
    if (this.propietario === undefined) {
      this.propietario = propietario;
      return;
    }
    await new Promise<void>((resolve) => this.esperando.push(resolve));
    this.propietario = propietario;
  }

  liberar(propietario: string): void {
    if (this.propietario !== propietario) throw new Error('unlock de advisory lock incorrecto');
    this.propietario = undefined;
    this.esperando.shift()?.();
  }
}

describe('ArchivosCvService: subida frente a retención', () => {
  it('bloquea antes del DELETE y conserva el blob compartido', async () => {
    const bytes = Buffer.from('%PDF-1.7\nblob compartido', 'latin1');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const locks = new AdvisoryLockDoble();
    const referencias = new Set(['candidato-retencion', 'candidato-compartido']);
    const eventos: string[] = [];
    let permitirDelete!: () => void;
    const deletePermitido = new Promise<void>((resolve) => (permitirDelete = resolve));
    let guardados = 0;
    let retirados = 0;

    const almacenamiento = {
      guardar: async () => {
        guardados += 1;
        return { sha256, deduplicado: true };
      },
      retirar: async () => {
        retirados += 1;
        return true;
      },
    };

    const clienteRetencion = {
      async query(
        sql: string,
      ): Promise<{ rowCount: number; rows: Array<Record<string, unknown>> }> {
        if (sql === 'BEGIN') return { rowCount: 0, rows: [] };
        if (sql.includes('GROUP BY p.candidato_id')) {
          return { rowCount: 1, rows: [{ candidato_id: 'candidato-retencion' }] };
        }
        if (sql.includes('SELECT DISTINCT sha256')) return { rowCount: 1, rows: [{ sha256 }] };
        if (sql.startsWith('SELECT pg_advisory_lock')) {
          eventos.push('lock-retencion');
          await locks.adquirir('retencion');
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('DELETE FROM archivos_cv')) {
          eventos.push('delete');
          await deletePermitido;
          referencias.delete('candidato-retencion');
          return { rowCount: 1, rows: [{ sha256 }] };
        }
        if (sql === 'COMMIT') {
          eventos.push('commit');
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT 1 FROM archivos_cv')) {
          // El otro candidato mantiene la misma referencia: no se debe retirar.
          return referencias.has('candidato-compartido')
            ? { rowCount: 1, rows: [{ sha256 }] }
            : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT pg_advisory_unlock')) {
          eventos.push('unlock-retencion');
          locks.liberar('retencion');
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`SQL no contemplado en doble: ${sql}`);
      },
      release: () => undefined,
    } as unknown as PoolClient;

    const clienteSubida = {
      async query(
        sql: string,
      ): Promise<{ rowCount: number; rows: Array<Record<string, unknown>> }> {
        if (sql.includes('SELECT 1 FROM candidatos')) return { rowCount: 1, rows: [{}] };
        if (sql.includes('set_config')) return { rowCount: 1, rows: [] };
        if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
          eventos.push('lock-subida');
          await locks.adquirir('subida');
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('INSERT INTO archivos_cv')) {
          referencias.add('candidato-nuevo');
          return {
            rowCount: 1,
            rows: [
              {
                id: 'archivo-nuevo',
                candidato_id: 'candidato-nuevo',
                sha256,
                filename_original: 'cv.pdf',
                mime_type: 'application/pdf',
                size_bytes: String(bytes.length),
                created_at: new Date(),
              },
            ],
          };
        }
        throw new Error(`SQL no contemplado en subida: ${sql}`);
      },
    } as unknown as PoolClient;

    const database = {
      pool: { connect: async () => clienteRetencion },
    };
    const servicio = new ArchivosCvService(database as never, almacenamiento as never);
    const archivo: ArchivoSubido = { originalname: 'cv.pdf', buffer: bytes };

    const purga = servicio.retirarCvDescartadosAntesDe(new Date(Date.now() + 1000));
    while (!eventos.includes('lock-retencion')) await Promise.resolve();
    const subida = servicio.subirEnTransaccion(clienteSubida, 'candidato-nuevo', archivo, 'actor');
    await Promise.resolve();
    expect(guardados).toBe(0);
    expect(eventos).toEqual(['lock-retencion']);

    permitirDelete();
    await purga;
    await subida;
    locks.liberar('subida'); // simula COMMIT de la transacción padre de importación.

    expect(eventos).toEqual([
      'lock-retencion',
      'lock-subida',
      'delete',
      'commit',
      'unlock-retencion',
    ]);
    expect(guardados).toBe(1);
    expect(retirados).toBe(0);
  });

  it('libera el lock de sesión aunque falle el borrado del blob', async () => {
    const sha256 = 'a'.repeat(64);
    const locks = new AdvisoryLockDoble();
    const eventos: string[] = [];
    const cliente = {
      async query(
        sql: string,
      ): Promise<{ rowCount: number; rows: Array<Record<string, unknown>> }> {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('GROUP BY p.candidato_id')) {
          return { rowCount: 1, rows: [{ candidato_id: 'candidato-retencion' }] };
        }
        if (sql.includes('SELECT DISTINCT sha256')) return { rowCount: 1, rows: [{ sha256 }] };
        if (sql.startsWith('SELECT pg_advisory_lock')) {
          await locks.adquirir('retencion');
          eventos.push('lock');
          return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('DELETE FROM archivos_cv')) return { rowCount: 1, rows: [{ sha256 }] };
        if (sql.includes('SELECT 1 FROM archivos_cv')) return { rowCount: 0, rows: [] };
        if (sql.startsWith('SELECT pg_advisory_unlock')) {
          locks.liberar('retencion');
          eventos.push('unlock');
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`SQL no contemplado en fallo FS: ${sql}`);
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const database = { pool: { connect: async () => cliente } };
    const almacenamiento = {
      retirar: async () => {
        throw new Error('fallo de FS simulado');
      },
    };
    const servicio = new ArchivosCvService(database as never, almacenamiento as never);

    await expect(servicio.retirarCvDescartadosAntesDe(new Date(Date.now() + 1000))).rejects.toThrow(
      'fallo de FS simulado',
    );
    expect(eventos).toEqual(['lock', 'unlock']);
  });
});
