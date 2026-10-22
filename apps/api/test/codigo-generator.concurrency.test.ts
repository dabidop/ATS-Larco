import './helpers/dev-db-env'; // ANTES que test-env: carga el .env raíz (BD dev docker)
import './helpers/test-env';

import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CodigoGeneratorService } from '../src/modules/requerimientos/codigo-generator.service';
import { Requerimiento } from '../src/modules/requerimientos/requerimiento.entity';
import { RequerimientosStoreService } from '../src/modules/requerimientos/requerimientos-store.service';

/**
 * Generador de códigos — test de CONCURRENCIA contra la BD dev real.
 *
 * ⚠ ESTE test (y SOLO este) usa la base de datos de desarrollo de docker
 * (`DATABASE_URL` del `.env` raíz → localhost:5432/ats_dev). Motivo: la
 * garantía de unicidad y correlatividad de `REQ-YYYY-NNN` es de POSTGRESQL
 * (upsert `ON CONFLICT ... DO UPDATE` que serializa las transacciones sobre
 * la fila del contador), no de la aplicación, y simularla con dobles en
 * memoria demostraría exactamente nada. Los tests UNITARIOS del generador
 * (`src/modules/requerimientos/codigo-generator.service.test.ts`) siguen
 * siendo herméticos: la suite completa no depende de dobles contra BD falsa.
 *
 * AISLAMIENTO (Etapa 8, arreglo de flakiness): el test congela el año en
 * 1990 —una fila PROPIA de `codigo_sequences`— en lugar de usar el año en
 * curso. Antes compartía la fila del año real con el resto de la suite (que
 * crea requerimientos vía API en paralelo), con dos efectos nocivos:
 *  1. `afterAll` borraba el contador del año en curso y las creaciones
 *     posteriores chocaban con `requerimientos_code_key` → 500 esporádicos.
 *  2. Un requerimiento creado por OTRO archivo entre medias se llevaba un
 *     número de la tira y rompía la aserción de «correlativos sin huecos».
 * Con año propio, la fila 1990 solo la usa este test: la serialización que
 * se demuestra (bloqueo de fila del upsert) es idéntica sea cual sea el año.
 *
 * Limpieza: `afterAll` borra SOLO la fila del año 1990 que este test pudo
 * crear en `codigo_sequences` y comprueba que no se insertó ninguna fila en
 * `requerimientos`, de modo que la BD dev queda como estaba (el test puede
 * repetirse —seguidas o no— con el mismo resultado).
 */

/** Número de llamadas concurrentes (exigido por el plan de la Fase 3). */
const LLAMADAS_CONCURRENTES = 25;

/**
 * Año CONGELADO de este test: ficticio y propio (1990). Ningún otro archivo
 * de la suite genera códigos de 1990, así que la fila del contador está
 * garantizadamente aislada del resto del mundo (BD dev incluida).
 */
const ANIO_DE_PRUEBA = 1990;

/** Subclase que CONGELA el año (mismo patrón hermético que los tests unitarios). */
class GeneradorConAnioFijo extends CodigoGeneratorService {
  protected override anioEnZonaDeLaEmpresa(_fecha?: Date): number {
    return ANIO_DE_PRUEBA;
  }
}

describe('CodigoGeneratorService — concurrencia real (BD dev docker)', () => {
  let dataSource: DataSource;
  let store: RequerimientosStoreService;
  let generador: CodigoGeneratorService;
  /** Filas en `requerimientos` ANTES del test: el generador no debe tocarla. */
  let requerimientosAntes: number;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || url.includes('127.0.0.1:5555')) {
      // test-env fija esa URL falsa como último recurso: aquí haría falta la
      // BD dev real. Falla temprano y con mensaje claro si docker no corre.
      throw new Error(
        'Este test necesita la BD dev de docker: revisa docker-compose.dev.yml y el .env raíz (DATABASE_URL)',
      );
    }

    // Mismo DataSource que construye el módulo (entidades y synchronize:false
    // idénticos); el store hace la inicialización LAZY al primer uso.
    dataSource = new DataSource({
      type: 'postgres',
      url,
      entities: [Requerimiento],
      synchronize: false,
    });
    store = new RequerimientosStoreService(dataSource);
    generador = new GeneradorConAnioFijo(store);

    // Inicialización perezosa del store (patrón de la parte 1).
    await store.repo();

    // Estado limpio garantizado: si una corrida anterior se cortó a medias,
    // la fila 1990 residual no debe contaminar la tira de esta corrida.
    await dataSource.query('DELETE FROM codigo_sequences WHERE anio = $1', [ANIO_DE_PRUEBA]);

    const filas = (await dataSource.query(
      'SELECT COUNT(*)::int AS total FROM requerimientos',
    )) as Array<{ total: number }>;
    requerimientosAntes = filas[0]?.total ?? 0;
  });

  afterAll(async () => {
    // Si el beforeAll falló (p.ej. docker caído), no hay conexión que cerrar
    // ni filas que limpiar.
    if (!dataSource?.isInitialized) {
      return;
    }

    // Limpieza quirúrgica: SOLO la fila del año propio de este test, para
    // dejar la BD dev como estaba (cualquier otro año queda intacto).
    await dataSource.query('DELETE FROM codigo_sequences WHERE anio = $1', [ANIO_DE_PRUEBA]);

    // El generador solo RESERVA números: no debe haber creado requerimientos.
    const filas = (await dataSource.query(
      'SELECT COUNT(*)::int AS total FROM requerimientos',
    )) as Array<{ total: number }>;
    expect(filas[0]?.total).toBe(requerimientosAntes);

    await store.onModuleDestroy(); // cierra la conexión que este test abrió
  });

  it(`${LLAMADAS_CONCURRENTES} llamadas en paralelo producen códigos únicos, consecutivos y del año congelado`, async () => {
    const codigos = await Promise.all(
      Array.from({ length: LLAMADAS_CONCURRENTES }, () => generador.siguienteCodigo()),
    );

    // 1) Cantidad y unicidad: 25 códigos, 25 distintos (sin dobles emitidos).
    expect(codigos).toHaveLength(LLAMADAS_CONCURRENTES);
    expect(new Set(codigos).size).toBe(LLAMADAS_CONCURRENTES);

    // 2) Formato y año: todos `REQ-<año congelado>-NNN`.
    for (const codigo of codigos) {
      expect(codigo).toMatch(new RegExp(`^REQ-${ANIO_DE_PRUEBA}-[0-9]{3,}$`));
    }

    // 3) Consecutividad SIN huecos: 25 números distintos cuyo recorrido mide
    //    exactamente 24 (max - min) solo puede ser una tira corrida.
    const numeros = codigos.map((codigo) => Number(codigo.split('-')[2])).sort((a, b) => a - b);
    const minimo = numeros[0] ?? 0;
    const maximo = numeros[numeros.length - 1] ?? 0;
    expect(maximo - minimo).toBe(LLAMADAS_CONCURRENTES - 1);
    expect(new Set(numeros).size).toBe(LLAMADAS_CONCURRENTES);

    // 4) El contador en BD coincide con el último código emitido.
    const filas = (await dataSource.query('SELECT ultimo FROM codigo_sequences WHERE anio = $1', [
      ANIO_DE_PRUEBA,
    ])) as Array<{ ultimo: number | string }>;
    expect(Number(filas[0]?.ultimo)).toBe(maximo);
  });
});
