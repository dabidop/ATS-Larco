import { Injectable } from '@nestjs/common';

import { RequerimientosStoreService } from './requerimientos-store.service';

/**
 * Zona horaria de la empresa: Colombia (UTC-5, sin horario de verano).
 * OJO: el identificador IANA es `America/Bogota` SIN tilde; `Intl` rechaza
 * cualquier variante acentuada con `RangeError: Invalid time zone`.
 *
 * El año del código `REQ-YYYY-NNN` se calcula en ESTA zona, no en UTC: la
 * empresa opera en Colombia y a las 19:00 del 31 de diciembre hora local el
 * reloj UTC ya marca 1 de enero. Usar el año UTC fabricaría códigos
 * `REQ-(anio+1)-001` con aún 5 horas de despacho del año anterior, rompiendo
 * la correlación perceptible para Gestión Humana ("el primer requerimiento de
 * enero" debe ser REQ-(anio nuevo)-001 a medianoche local).
 */
export const ZONA_HORARIA_EMPRESA = 'America/Bogota';

/**
 * Un ÚNICO upsert atómico por llamada.
 *
 * `INSERT ... ON CONFLICT (anio) DO UPDATE ... RETURNING ultimo` es atómico en
 * PostgreSQL por sí mismo: ante llamadas concurrentes sobre la MISMA fila, el
 * `UPDATE` toma un bloqueo de fila y las transacciones se serializan, de modo
 * que cada una recibe un `ultimo` distinto sin carreras ni bloqueos perdidos
 * (nada de "leer contar escribir" en la aplicación). La transacción que
 * envuelve la llamada (`store.withTransaction`) además cumple el requerimiento
 * del plan y protege el formato: si algo falla DESPUÉS del upsert, el
 * roll-back revierte el incremento y no se emite ningún código huérfano.
 */
const SQL_RESERVAR_ULTIMO = `
  INSERT INTO codigo_sequences (anio, ultimo)
  VALUES ($1, 1)
  ON CONFLICT (anio) DO UPDATE
    SET ultimo = codigo_sequences.ultimo + 1
  RETURNING ultimo
`;

/**
 * Comprobación de que un código reservado sigue LIBRE en la tabla. La BD es
 * quien manda: `requerimientos.code` es UNIQUE, así que si el número que
 * acabamos de reservar ya está en uso (fila insertada a mano, backup
 * restaurado, contador desfasado), lo comprobamos aquí y seguimos.
 */
const SQL_CODIGO_LIBRE = 'SELECT 1 FROM requerimientos WHERE code = $1';

/**
 * Techo de números que UNA sola llamada puede saltar antes de rendirse: un
 * contador caóticamente desfasado produce un error claro (y recuperable con
 * SQL) en lugar de un bucle infinito o un 500 opaco.
 */
const MAX_SALTOS = 1000;

/**
 * Generador atómico de códigos correlativos `REQ-YYYY-NNN` (Fase 3, parte 2).
 *
 * El contador vive en la tabla `codigo_sequences` (migración 003:
 * `anio int PK, ultimo int NOT NULL DEFAULT 0`), un registro por año. La
 * unicidad del código no depende de esta clase: la garantiza la propia BD
 * (`requerimientos.code` es `UNIQUE` con CHECK `^REQ-[0-9]{4}-[0-9]{3,}$`).
 *
 * Rango del correlativo: empieza en 001 cada año y, al superar 999, SIGUE
 * CRECIENDO normalmente (1000, 1001, …). No hay bandera de desbordamiento
 * porque el CHECK de BD permite 3 o MÁS dígitos; `padStart(3, '0')` solo
 * rellena hasta 3 posiciones y no trunca por encima.
 */
@Injectable()
export class CodigoGeneratorService {
  constructor(private readonly store: RequerimientosStoreService) {}

  /**
   * Reserva y devuelve el siguiente código `REQ-YYYY-NNN` LIBRE.
   *
   * Cada intento consume UN número de la secuencia anual dentro de la MISMA
   * transacción. Si el número reservado ya existe en `requerimientos` (fila
   * insertada a mano, backup restaurado o contador desfasado — la unicidad
   * real la garantiza la BD vía `requerimientos.code` UNIQUE), el generador
   * LO SALTA y reserva el siguiente, en vez de propagar un 500 permanente.
   * Con la fila del contador bloqueada (`FOR UPDATE` implícito del upsert),
   * los saltos también quedan serializados ante generadores concurrentes.
   *
   * Si la transacción falla, el error se PROPAGA sin envolver y el roll-back
   * revierte el incremento: no se pierde ningún código (el siguiente intento
   * lo reutiliza).
   */
  async siguienteCodigo(): Promise<string> {
    const anio = this.anioEnZonaDeLaEmpresa();

    return this.store.withTransaction(async (em) => {
      for (let intento = 0; intento <= MAX_SALTOS; intento++) {
        const filas = (await em.query(SQL_RESERVAR_ULTIMO, [anio])) as Array<{
          ultimo: number | string;
        }>;
        const fila = filas[0];
        if (!fila) {
          // Inalcanzable con ON CONFLICT ... RETURNING (siempre devuelve la fila
          // insertada o la actualizada); defensa ante cambios futuros en el SQL.
          throw new Error('codigo_sequences: el upsert no devolvió ninguna fila');
        }
        // pg devuelve int4 como number; Number() cubre drivers que lo devuelven texto.
        const numero = Number(fila.ultimo);
        const codigo = `REQ-${anio}-${String(numero).padStart(3, '0')}`;

        const ocupadas = (await em.query(SQL_CODIGO_LIBRE, [codigo])) as unknown[];
        if (ocupadas.length === 0) {
          return codigo;
        }
        // Ocupado: el número ya se consumió en el contador; el siguiente
        // intento reserva el posterior (sin huecos innecesarios).
      }
      throw new Error(
        `codigo_sequences: ${MAX_SALTOS} números seguidos de ${anio} ya existen en requerimientos; revisa el contador con SQL`,
      );
    });
  }

  /**
   * Año actual (o el de la `fecha` dada) en la zona horaria de la empresa.
   *
   * PROTEGIDO y con `fecha` opcional a propósito: los tests unitarios lo
   * exponen vía una subclase para fijar el año sin tocar el global `Date`
   * (evita `vi.setSystemTime` y su efecto sobre el resto de la suite).
   * `Intl.DateTimeFormat` con `timeZone` es la forma estándar de convertir un
   * instante UTC a una fecha local de zona arbitraria.
   */
  protected anioEnZonaDeLaEmpresa(fecha: Date = new Date()): number {
    const formateador = new Intl.DateTimeFormat('en-US', {
      timeZone: ZONA_HORARIA_EMPRESA,
      year: 'numeric',
    });
    return Number(formateador.format(fecha));
  }
}
