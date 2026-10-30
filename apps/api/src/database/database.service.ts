import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';
import type { PoolClient } from 'pg';

import type { Env } from '../config/env.validation';

/**
 * Ajustes del pool de conexiones. `pg` NO conecta al construirse: las
 * conexiones se abren bajo demanda, así que el arranque no depende de que
 * PostgreSQL esté disponible.
 */
const POOL_SETTINGS = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
} as const;

/**
 * Proveedor único (singleton) del pool `pg`, leído de `DATABASE_URL` ya
 * validada. Expone el pool y un helper `query`; cierra todas las conexiones
 * al apagar la aplicación (`onModuleDestroy`).
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(config: ConfigService<Env, true>) {
    this.pool = new Pool({
      connectionString: config.getOrThrow('DATABASE_URL'),
      ...POOL_SETTINGS,
    });
  }

  /** Ejecuta una consulta parametrizada (`$1`, `$2`, ...) contra el pool. */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  /** Ejecuta varias operaciones sobre la misma conexión y las confirma juntas. */
  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
