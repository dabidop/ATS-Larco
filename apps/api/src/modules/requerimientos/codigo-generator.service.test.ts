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
 * `EntityManager` falso. Su `query` DISTINGUE las dos consultas reales del
 * generador: el upsert del contador devuelve `[[{ ultimo }]]` (la forma que
 * devuelve el upsert real) y la comprobación `SELECT 1 FROM requerimientos`
 * devuelve [] (código libre) salvo que se indique lo contrario. Con
 * `ultimoDevuelto = null` fingimos el caso (inalcanzable) de un upsert sin
 * filas.
 */
function crearStoreDoble(ultimoDevuelto: number | null) {
  const emFalso = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM requerimientos')) {
        return []; // código libre por defecto
      }
      return ultimoDevuelto === null ? [] : [{ ultimo: ultimoDevuelto }];
    }),
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
    expect(emFalso.query).toHaveBeenCalledTimes(2); // upsert + comprobación de libre
    expect(emFalso.query.mock.calls[0]?.[1]).toEqual([2031]);
  });
});

describe('CodigoGeneratorService — atomicidad y errores', () => {
  it('reserva con un único upsert y comprueba que el código está libre en la BD', async () => {
    const { store, emFalso, withTransaction } = crearStoreDoble(13);
    const generador = new ConAnioFijo(store, 2031);

    await expect(generador.siguienteCodigo()).resolves.toBe('REQ-2031-013');

    // El upsert va DENTRO de la transacción (EntityManager transaccional),
    // con la cláusula atómica ON CONFLICT ... RETURNING, y DESPUÉS consulta
    // `requerimientos` para confirmar que el código reservado sigue libre.
    expect(withTransaction).toHaveBeenCalledTimes(1);
    const [sqlUpset] = emFalso.query.mock.calls[0] ?? [];
    expect(sqlUpset).toContain('ON CONFLICT (anio) DO UPDATE');
    expect(sqlUpset).toContain('RETURNING ultimo');
    const [sqlLibre, paramsLibre] = emFalso.query.mock.calls[1] ?? [];
    expect(sqlLibre).toContain('SELECT 1 FROM requerimientos');
    expect(paramsLibre).toEqual(['REQ-2031-013']);
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

describe('CodigoGeneratorService — auto-sanación de contadores desfasados', () => {
  /**
   * Doble que SABE qué códigos existen en `requerimientos` (p. ej. 004 y
   * 005) y devuelve números de contador crecientes (4, 5, 6, …) como el
   * upsert real, para fingir un contador desfasado tras la realidad.
   */
  function crearDobleConOcupados(numeros: number[], ocupados: number[]) {
    let indice = 0;
    const emFalso = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM requerimientos')) {
          const codigo = String(params?.[0] ?? '');
          const numero = Number(codigo.split('-')[2]);
          return ocupados.includes(numero) ? [{ existe: 1 }] : [];
        }
        return [{ ultimo: numeros[indice++] ?? (numeros[numeros.length - 1] ?? 1) }];
      }),
    };
    const withTransaction = vi.fn(
      async (fn: (em: EntityManager) => Promise<unknown>): Promise<unknown> =>
        fn(emFalso as unknown as EntityManager),
    );
    const store = { withTransaction } as unknown as RequerimientosStoreService;
    return { store, emFalso };
  }

  it('salta los números que ya existen en requerimientos y devuelve el primero libre', async () => {
    // Contador desfasado: 004 y 005 ya están en la tabla (fila manual o
    // backup restaurado); el generador los consume y emite 006, no un 500.
    const { store, emFalso } = crearDobleConOcupados([4, 5, 6], [4, 5]);
    const generador = new ConAnioFijo(store, 2031);

    await expect(generador.siguienteCodigo()).resolves.toBe('REQ-2031-006');

    // Tres reservas + tres comprobaciones = 6 consultas, y la última
    // comprobación fue exactamente sobre el código devuelto.
    expect(emFalso.query).toHaveBeenCalledTimes(6);
    const [sqlUltima, paramsUltima] = emFalso.query.mock.calls[5] ?? [];
    expect(sqlUltima).toContain('SELECT 1 FROM requerimientos');
    expect(paramsUltima).toEqual(['REQ-2031-006']);
  });

  it('rinde con un error claro tras agotar el techo de saltos', async () => {
    // Contador caótico: TODOS los números aparecen ocupados. Con el techo
    // de 1000 saltos, la llamada falla de forma explícita (recuperable con
    // SQL) en vez de quedar en bucle infinito o emitir un código tomado.
    const { store } = crearDobleConOcupados([1], [1]);
    const generador = new ConAnioFijo(store, 2031);

    await expect(generador.siguienteCodigo()).rejects.toThrow(
      '1000 números seguidos de 2031 ya existen en requerimientos',
    );
  });
});
