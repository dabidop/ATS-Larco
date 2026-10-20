import './helpers/test-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { Pool } from 'pg';
import request from 'supertest';
import type { EntityManager, Repository } from 'typeorm';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { Requerimiento } from '../src/modules/requerimientos/requerimiento.entity';
import { RequerimientosStoreService } from '../src/modules/requerimientos/requerimientos-store.service';

/**
 * Requerimientos — Fase 3, parte 1: `DataSource` perezoso + store.
 *
 * Hermeticidad garantizada: el `DataSource` real se SUSTITUYE por un doble, así
 * que `AppModule` arranca sin abrir ninguna conexión (el `DataSource` real solo
 * se construye, nunca se inicializa, y aquí ni eso). Ninguna aserción toca la
 * base de datos.
 */

/** Doble mínimo de `DataSource`: registra las llamadas y finge el estado. */
function crearDobleDataSource() {
  const estado = { inicializado: false };
  const emFalso = { marca: 'em-falso-transaccion' } as unknown as EntityManager;
  const repoFalso = { marca: 'repo-requerimientos-falso' } as unknown as Repository<Requerimiento>;

  return {
    estado,
    emFalso,
    repoFalso,
    get isInitialized(): boolean {
      return estado.inicializado;
    },
    initialize: vi.fn(async () => {
      estado.inicializado = true;
    }),
    getRepository: vi.fn(() => repoFalso),
    transaction: vi.fn(async (fn: (em: EntityManager) => Promise<unknown>) => fn(emFalso)),
    destroy: vi.fn(async () => {
      estado.inicializado = false;
    }),
  };
}

/** Doble en memoria del pool `pg` (mismo patrón que el resto de tests e2e). */
function createFakeDatabase(): DatabaseService {
  return {
    pool: {} as Pool,
    query: async () => ({ rows: [{ ok: 1 }] }),
    onModuleDestroy: async () => {},
  } as unknown as DatabaseService;
}

describe('Requerimientos: DataSource lazy + store (e2e)', () => {
  let app: INestApplication;
  let doble: ReturnType<typeof crearDobleDataSource>;
  let store: RequerimientosStoreService;
  let tokenAdmin: string;

  beforeAll(async () => {
    doble = crearDobleDataSource();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(createFakeDatabase())
      .overrideProvider(DataSource)
      .useValue(doble as unknown as DataSource)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    store = app.get(RequerimientosStoreService);

    // Token de admin emitido con el JwtService global (mismo secret que la app).
    tokenAdmin = app.get(JwtService).sign({
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'admin@larco.co',
      role: 'admin_rrhh',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('AppModule construye con el DataSource SIN inicializar (no abre conexión)', () => {
    expect(doble.initialize).not.toHaveBeenCalled();
    expect(doble.estado.inicializado).toBe(false);
  });

  it('GET /api/requerimientos/ping sigue operativo con el DataSource perezoso', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/requerimientos/ping')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(response.body).toEqual({ modulo: 'requerimientos', status: 'placeholder' });
    // El ping no debe haber abierto la conexión del módulo.
    expect(doble.initialize).not.toHaveBeenCalled();
  });

  it('repo() inicializa de forma perezosa y UNA sola vez', async () => {
    const repo = await store.repo();
    const repoOtraVez = await store.repo();

    expect(repo).toBeDefined();
    expect(repoOtraVez).toBe(repo);
    expect(doble.initialize).toHaveBeenCalledTimes(1);
    expect(doble.getRepository).toHaveBeenCalledWith(Requerimiento);
    expect(doble.estado.inicializado).toBe(true);
  });

  it('withTransaction entrega el EntityManager de la transacción al callback', async () => {
    const inicializacionesAntes = doble.initialize.mock.calls.length;
    let emRecibido: EntityManager | null = null;

    const salida = await store.withTransaction(async (em) => {
      emRecibido = em;
      return 'ok';
    });

    expect(salida).toBe('ok');
    expect(emRecibido).toBe(doble.emFalso);
    expect(doble.transaction).toHaveBeenCalledTimes(1);
    // Ya inicializado: no vuelve a conectar.
    expect(doble.initialize.mock.calls.length).toBe(inicializacionesAntes);
  });

  it('onModuleDestroy solo destruye el DataSource si estaba inicializado', async () => {
    await store.onModuleDestroy();
    expect(doble.destroy).toHaveBeenCalledTimes(1);
    expect(doble.estado.inicializado).toBe(false);

    // Segunda llamada (ya cerrado): nada que destruir, no revienta el apagado.
    await store.onModuleDestroy();
    expect(doble.destroy).toHaveBeenCalledTimes(1);
  });
});
