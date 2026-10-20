import type { EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import type { RequerimientosStoreService } from './requerimientos-store.service';
import { CodigoGeneratorService } from './codigo-generator.service';

/**
 * Tests unitarios del generador de códigos `REQ-YYYY-NNN` (Fase 3, parte 2).
 *
 * Herméticos: el store se SUSTITUYE por un doble mínimo, así que NINGUNA
 * aserción toca la base de datos (la concurrencia real se testea contra la BD
 * dev de docker en `test/codigo-generator.concurrency.test.ts`).
 * El año se congela exponiendo el método protegido vía subclases; NO se toca
 * el global `Date` (evita efectos colaterales sobre el resto de la suite).
 */

/** Subclase que EXPONE el método protegido de año, para probarlo con fechas fijas. */
class EspiaDeAnio extends CodigoGeneratorService {
  anioDe(fecha: Date): number {
    return this.anioEnZonaDeLaEmpresa(fecha);
  }
}

/** Subclase que CONGELA el año (fijo de fábrica), sin tocar el global `Date`. */
class ConAnioFijo extends CodigoGeneratorService {
  constructor(
    store: RequerimientosStoreService,
    private readonly anioFijo: number,
  ) {
    super(store);
  }

  protected override anioEnZonaDeLaEmpresa(_fecha?: Date): number {
    return this.anioFijo;
  }
}

/**
 * Doble de `RequerimientosStoreService`: `withTransaction` entrega un
 * `EntityManager` falso cuyo `query` devuelve `[[{ ultimo }]]` (la forma que
 * devuelve el upsert real). Con `ultimoDevuelto = null` fingimos el caso
 * (inalcanzable) de una consulta sin filas.
 */
function crearStoreDoble(ultimoDevuelto: number | null) {
  const emFalso = {
    query: vi.fn(async (_sql: string, _params?: unknown[]) =>
      ultimoDevuelto === null ? [] : [{ ultimo: ultimoDevuelto }],
    ),
  };
  const withTransaction = vi.fn(
    async (fn: (em: EntityManager) => Promise<unknown>): Promise<unknown> =>
      fn(emFalso as unknown as EntityManager),
  );
  const store = { withTransaction } as unknown as RequerimientosStoreService;
  return { store, emFalso, withTransaction };
}

describe('CodigoGeneratorService — formateo', () => {
  it('devuelve REQ-YYYY-NNN con relleno de 3 dígitos', async () => {
    const { store } = crearStoreDoble(7);
    const generador = new ConAnioFijo(store, 2031);

    await expect(generador.siguienteCodigo()).resolves.toBe('REQ-2031-007');
  });

  it('rellena también centenas y decenas (42 → 042, 999 → 999)', async () => {
    const { store: store42 } = crearStoreDoble(42);
    const { store: store999 } = crearStoreDoble(999);

    await expect(new ConAnioFijo(store42, 2031).siguienteCodigo()).resolves.toBe('REQ-2031-042');
    await expect(new ConAnioFijo(store999, 2031).siguienteCodigo()).resolves.toBe('REQ-2031-999');
  });

  it('pasados los 999 sigue creciendo sin truncar (1000 → REQ-2031-1000)', async () => {
    // El CHECK de BD `^REQ-[0-9]{4}-[0-9]{3,}$` admite 3 o MÁS dígitos, así
    // que no hay bandera de desbordamiento: el correlativo simplemente crece.
    const { store } = crearStoreDoble(1000);
    const generador = new ConAnioFijo(store, 2031);

    await expect(generador.siguienteCodigo()).resolves.toBe('REQ-2031-1000');
  });
});

describe('CodigoGeneratorService — año en zona horaria de la empresa', () => {
  it('usa el año de America/Bogota (hora de la empresa), no el de UTC', () => {
    const generador = new EspiaDeAnio({} as RequerimientosStoreService);

    // 04:59 UTC del 1 de enero = 23:59 del 31 de diciembre en Bogotá (UTC-5):
    // para la empresa sigue siendo 2026 aunque en UTC ya sea 2027.
    expect(generador.anioDe(new Date('2027-01-01T04:59:00Z'))).toBe(2026);
    // 05:00 UTC = medianoche exacta en Bogotá: ya es 2027.
    expect(generador.anioDe(new Date('2027-01-01T05:00:00Z'))).toBe(2027);
    // Comprobación a mitad de año (regresión trivial).
    expect(generador.anioDe(new Date('2026-06-15T12:00:00Z'))).toBe(2026);
  });

  it('siguienteCodigo() reserva el número contra el contador de ESE año', async () => {
    const { store, emFalso } = crearStoreDoble(1);
    const generador = new ConAnioFijo(store, 2031);

    await expect(generador.siguienteCodigo()).resolves.toBe('REQ-2031-001');
    expect(emFalso.query).toHaveBeenCalledTimes(1);
    expect(emFalso.query.mock.calls[0]?.[1]).toEqual([2031]);
  });
});

describe('CodigoGeneratorService — atomicidad y errores', () => {
  it('reserva el número con un ÚNICO upsert dentro de withTransaction', async () => {
    const { store, emFalso, withTransaction } = crearStoreDoble(13);
    const generador = new ConAnioFijo(store, 2031);

    await expect(generador.siguienteCodigo()).resolves.toBe('REQ-2031-013');

    // El upsert va DENTRO de la transacción (EntityManager transaccional),
    // con la cláusula atómica ON CONFLICT ... RETURNING.
    expect(withTransaction).toHaveBeenCalledTimes(1);
    const [sql] = emFalso.query.mock.calls[0] ?? [];
    expect(sql).toContain('ON CONFLICT (anio) DO UPDATE');
    expect(sql).toContain('RETURNING ultimo');
  });

  it('propaga el error de la transacción (el roll-back revierte el incremento)', async () => {
    const errorEsperado = new Error('fallo de BD');
    const withTransaction = vi.fn(async () => {
      throw errorEsperado;
    });
    const store = { withTransaction } as unknown as RequerimientosStoreService;
    const generador = new ConAnioFijo(store, 2031);

    // Sin envolver: el consumidor (parte 3) decide el manejo. Como el upsert
    // ocurrió en la transacción reviertida, no se emite ni se pierde código.
    await expect(generador.siguienteCodigo()).rejects.toThrow('fallo de BD');
  });

  it('falla de forma explícita si el upsert no devuelve ninguna fila', async () => {
    const { store } = crearStoreDoble(null);
    const generador = new ConAnioFijo(store, 2031);

    await expect(generador.siguienteCodigo()).rejects.toThrow(
      'codigo_sequences: el upsert no devolvió ninguna fila',
    );
  });
});
