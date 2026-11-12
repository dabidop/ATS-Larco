import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { EntrevistasService } from './entrevistas.service';

type Estado = 'activa' | 'contratado' | 'descartado';

function resultado<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { command: 'SELECT', rowCount, oid: 0, fields: [], rows };
}

function databaseDoble(estado: Estado) {
  const queries: string[] = [];
  const cliente = {
    query: vi.fn(async <T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> => {
      queries.push(sql);
      if (sql.includes('set_config')) return resultado<T>([]);
      if (sql.includes('FOR UPDATE')) return resultado<T>([{ estado } as unknown as T]);
      if (sql.includes('INSERT INTO entrevistas'))
        return resultado<T>([{ id: 'entrevista-1' } as unknown as T]);
      throw new Error(`SQL inesperado: ${sql}`);
    }),
  } as unknown as PoolClient;
  const database = {
    queries,
    pool: { connect: vi.fn() },
    withTransaction: vi.fn(async <T>(work: (client: PoolClient) => Promise<T>) => work(cliente)),
    query: vi.fn(async <T extends QueryResultRow>() =>
      resultado<T>([
        {
          id: 'entrevista-1',
          postulacion_id: 'post-1',
          fecha: '2026-11-02',
          hora: '09:30',
          tipo: 'Inicial',
          entrevistador: null,
          estado: 'agendada',
          notas: null,
          candidato_id: 'cand-1',
          candidato_nombre: 'Ada',
          candidato_apellidos: 'Lovelace',
          requerimiento_id: 'req-1',
          requerimiento_codigo: 'REQ-1',
          requerimiento_titulo: 'Ingeniería',
          created_at: new Date('2026-11-01T10:00:00Z'),
          updated_at: new Date('2026-11-01T10:00:00Z'),
        } as unknown as T,
      ]),
    ),
  };
  return { database, cliente };
}

const dto = { postulacionId: 'post-1', fecha: '2026-11-02', tipo: 'Inicial' };

describe('EntrevistasService.crear — serialización con el embudo', () => {
  it('devuelve 404 y no intenta el FK cuando la postulación no existe', async () => {
    const doble = databaseDoble('activa');
    doble.cliente.query = vi.fn(async <T extends QueryResultRow>(sql: string) => {
      doble.database.queries.push(sql);
      return sql.includes('FOR UPDATE') ? resultado<T>([]) : resultado<T>([]);
    }) as unknown as typeof doble.cliente.query;
    const service = new EntrevistasService(doble.database as never);

    await expect(service.crear(dto, 'actor-1')).rejects.toMatchObject({ status: 404 });
    expect(doble.database.queries.some((sql) => sql.includes('INSERT INTO entrevistas'))).toBe(
      false,
    );
  });

  it.each(['descartado', 'contratado'] as const)(
    'rechaza estado terminal %s con 409',
    async (estado) => {
      const doble = databaseDoble(estado);
      const service = new EntrevistasService(doble.database as never);

      await expect(service.crear(dto, 'actor-1')).rejects.toMatchObject({ status: 409 });
      expect(doble.database.queries.some((sql) => sql.includes('INSERT INTO entrevistas'))).toBe(
        false,
      );
    },
  );

  it('hace check+insert dentro de una transacción, bloqueando la fila y fijando el actor', async () => {
    const doble = databaseDoble('activa');
    const service = new EntrevistasService(doble.database as never);

    await expect(service.crear(dto, 'actor-1')).resolves.toMatchObject({
      id: 'entrevista-1',
      postulacionId: 'post-1',
    });
    expect(doble.database.withTransaction).toHaveBeenCalledTimes(1);
    expect(doble.database.queries[0]).toContain('set_config');
    expect(doble.database.queries[1]).toContain('FOR UPDATE');
    expect(doble.database.queries[2]).toContain('INSERT INTO entrevistas');
  });

  it('dos operaciones aisladas respetan el bloqueo: la segunda ve el terminal', async () => {
    let estado: Estado = 'activa';
    let enTransaccion = false;
    const database = {
      withTransaction: vi.fn(async <T>(work: (client: PoolClient) => Promise<T>) => {
        while (enTransaccion) await Promise.resolve();
        enTransaccion = true;
        const cliente = {
          query: vi.fn(async <R extends QueryResultRow>(sql: string): Promise<QueryResult<R>> => {
            if (sql.includes('FOR UPDATE')) return resultado<R>([{ estado } as unknown as R]);
            if (sql.includes('INSERT INTO entrevistas')) {
              estado = 'contratado';
              return resultado<R>([{ id: 'entrevista-1' } as unknown as R]);
            }
            return resultado<R>([]);
          }),
        } as unknown as PoolClient;
        try {
          return await work(cliente);
        } finally {
          enTransaccion = false;
        }
      }),
      query: vi.fn(async <T extends QueryResultRow>() =>
        resultado<T>([
          {
            id: 'entrevista-1',
            postulacion_id: 'post-1',
            fecha: '2026-11-02',
            hora: null,
            tipo: 'Inicial',
            entrevistador: null,
            estado: 'agendada',
            notas: null,
            candidato_id: 'cand-1',
            candidato_nombre: 'Ada',
            candidato_apellidos: 'Lovelace',
            requerimiento_id: 'req-1',
            requerimiento_codigo: 'REQ-1',
            requerimiento_titulo: 'Ingeniería',
            created_at: new Date('2026-11-01T10:00:00Z'),
            updated_at: new Date('2026-11-01T10:00:00Z'),
          } as unknown as T,
        ]),
      ),
    };
    const service = new EntrevistasService(database as never);
    const primera = service.crear(dto, 'actor-1');
    await expect(primera).resolves.toMatchObject({ id: 'entrevista-1' });
    await expect(service.crear(dto, 'actor-2')).rejects.toMatchObject({ status: 409 });
  });
});
