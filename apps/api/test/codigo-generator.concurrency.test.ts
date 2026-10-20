import './helpers/dev-db-env'; // ANTES que test-env: carga el .env raíz (BD dev docker)
import './helpers/test-env';

import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CodigoGeneratorService,
  ZONA_HORARIA_EMPRESA,
} from '../src/modules/requerimientos/codigo-generator.service';
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
 * Limpieza: `afterAll` borra SOLO la fila del año que este test pudo crear en
 * `codigo_sequences` y comprueba que no se insertó ninguna fila en
 * `requerimientos`, de modo que la BD dev queda como estaba (el test puede
 * repetirse —seguidas o no— con el mismo resultado).
 */

/** Número de llamadas concurrentes (exigido por el plan de la Fase 3). */
const LLAMADAS_CONCURRENTES = 25;

/** Año actual en la zona horaria de la empresa (misma regla que el servicio). */
function anioActualEnBogota(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HORARIA_EMPRESA, year: 'numeric' }).format(
      new Date(),
    ),
  );
}

describe('CodigoGeneratorService — concurrencia real (BD dev docker)', () => {
  let dataSource: DataSource;
  let store: RequerimientosStoreService;
  let generador: CodigoGeneratorService;
  let anioActual: number;
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

    anioActual = anioActualEnBogota();

    // Mismo DataSource que construye el módulo (entidades y synchronize:false
    // idénticos); el store hace la inicialización LAZY al primer uso.
    dataSource = new DataSource({
      type: 'postgres',
      url,
      entities: [Requerimiento],
      synchronize: false,
    });
    store = new RequerimientosStoreService(dataSource);
    generador = new CodigoGeneratorService(store);

    // Inicialización perezosa del store (patrón de la parte 1).
    await store.repo();
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

    // Limpieza quirúrgica: SOLO la fila del año usado por este test, para
    // dejar la BD dev como estaba (cualquier otro año queda intacto).
    await dataSource.query('DELETE FROM codigo_sequences WHERE anio = $1', [anioActual]);

    // El generador solo RESERVA números: no debe haber creado requerimientos.
    const filas = (await dataSource.query(
      'SELECT COUNT(*)::int AS total FROM requerimientos',
    )) as Array<{ total: number }>;
    expect(filas[0]?.total).toBe(requerimientosAntes);

    await store.onModuleDestroy(); // cierra la conexión que este test abrió
  });

  it(`${LLAMADAS_CONCURRENTES} llamadas en paralelo producen códigos únicos, consecutivos y del año actual`, async () => {
    const codigos = await Promise.all(
      Array.from({ length: LLAMADAS_CONCURRENTES }, () => generador.siguienteCodigo()),
    );

    // 1) Cantidad y unicidad: 25 códigos, 25 distintos (sin dobles emitidos).
    expect(codigos).toHaveLength(LLAMADAS_CONCURRENTES);
    expect(new Set(codigos).size).toBe(LLAMADAS_CONCURRENTES);

    // 2) Formato y año: todos `REQ-<año actual en Bogotá>-NNN`.
    for (const codigo of codigos) {
      expect(codigo).toMatch(new RegExp(`^REQ-${anioActual}-[0-9]{3,}$`));
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
      anioActual,
    ])) as Array<{ ultimo: number | string }>;
    expect(Number(filas[0]?.ultimo)).toBe(maximo);
  });
});
