/**
 * Fases y estados de una postulación + reglas del embudo (Fase 5, parte
 * backend).
 *
 * Fichero de DATOS puros (sin BD, sin Nest, sin I/O): replica el criterio de
 * `requerimientos-flujo.ts`, se puede testear en unitarios herméticos y es la
 * ÚNICA fuente de verdad del orden del tablero en la capa de aplicación (en BD
 * el orden vive en el ENUM `fase_postulacion` de la migración 007).
 *
 * REGLAS DE NEGOCIO que sostiene (decisiones ya tomadas en el plan +
 * retroalimentación Etapa 9):
 *  - El embudo tiene 5 fases EN ESTE ORDEN:
 *    `preseleccion → antecedentes → entrevistas → proveedor_externo → contratacion`.
 *  - Un movimiento VÁLIDO solo avanza UN PASO (el embudo NO retrocede: regla
 *    11 de la retroalimentación, Etapa 9 — antes admitía ±1). Saltar fases o
 *    devolver a una anterior → 409.
 *  - Llegar a `contratacion` ES contratar: la postulación pasa a estado
 *    `contratado` (terminal) en la MISMA operación, y SIEMPRE que se llene la
 *    última plaza disponible del requerimiento el servicio marca su requerimiento
 *    como `exitoso` («Contrato exitoso», Etapa 9).
 *  - `contratado` y `descartado` son ESTADOS TERMINALES: sin cambios de fase.
 *  - Descartar vale desde CUALQUIER fase (el endpoint no filtra por fase) y
 *    exige motivo; el resultado es el terminal `descartado`.
 */

/** Las 5 fases del embudo, EN ORDEN de avance (columnas del tablero Kanban). */
export const FASES = [
  'preseleccion',
  'antecedentes',
  'entrevistas',
  'proveedor_externo',
  'contratacion',
] as const;

/** Una de las 5 fases del embudo (equivalente al ENUM `fase_postulacion`). */
export type Fase = (typeof FASES)[number];

/** Estados de una postulación (ENUM `estado_postulacion`): 1 activa + 2 terminales. */
export const ESTADOS = ['activa', 'contratado', 'descartado'] as const;

/** Uno de los estados del ENUM `estado_postulacion`. */
export type Estado = (typeof ESTADOS)[number];

/** Fase cuyo alcance es el ESTADO terminal `contratado` (llegar allí ES contratar). */
export const FASE_CONTRATACION: Fase = 'contratacion';

/** Estados desde los que NO hay movimiento posible (sin salida). */
export const ESTADOS_TERMINALES: readonly Estado[] = ['contratado', 'descartado'];

/** Posición de cada fase en el tablero (0-based), en el orden del ENUM de BD. */
const INDICE_FASE: Readonly<Record<Fase, number>> = {
  preseleccion: 0,
  antecedentes: 1,
  entrevistas: 2,
  proveedor_externo: 3,
  contratacion: 4,
};

/**
 * ¿`estado` es TERMINAL? Un terminal no admite cambios de fase ni descartes:
 * la postulación ya tiene un desenlace definitivo.
 */
export function esTerminal(estado: Estado): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

/**
 * ¿`destino` es el SIGUIENTE paso de `origen`? El embudo SOLO AVANZA un paso
 * (Etapa 9): `antecedentes → entrevistas` es válido; `entrevistas →
 * antecedentes` (retroceso) y `preseleccion → entrevistas` (salto) NO lo son.
 */
export function esSiguiente(origen: Fase, destino: Fase): boolean {
  return INDICE_FASE[destino] - INDICE_FASE[origen] === 1;
}

/**
 * ¿`destino` es un RETROCESO respecto de `origen`? Existe solo para que el
 * servicio responda con el mensaje correcto («el embudo no retrocede» en vez
 * de «no se salta»).
 */
export function esRetroceso(origen: Fase, destino: Fase): boolean {
  return INDICE_FASE[destino] < INDICE_FASE[origen];
}

/** Fase SIGUIENTE a `fase`, o `undefined` si ya es la última (contratación). */
export function faseSiguiente(fase: Fase): Fase | undefined {
  return FASES[INDICE_FASE[fase] + 1];
}

/**
 * Estado RESULTANTE de mover una postulación `activa` a la fase `destino`:
 * `contratacion` ⇒ `contratado` (llegar allí es contratar); cualquier otra
 * fase ⇒ sigue `activa`. Las fases terminales no se mueven (lo decide el
 * servicio con un 409 antes de llegar aquí).
 */
export function estadoTrasMover(destino: Fase): Estado {
  return destino === FASE_CONTRATACION ? 'contratado' : 'activa';
}

/** 409 — destino IGUAL a la fase actual (no hay nada que mover). */
export function mensajeFaseActual(fase: Fase): string {
  return `La postulación ya está en la fase '${fase}': elige una fase distinta`;
}

/**
 * 409 — destino NO es el SIGUIENTE paso (salto de fases). El mensaje nombra
 * SIEMPRE el origen, el destino recibido y la ÚNICA fase a la que sí se puede
 * avanzar (útil para el cliente y para testear el texto).
 */
export function mensajeNoAdyacente(origen: Fase, destino: Fase): string {
  const siguiente = faseSiguiente(origen);
  const admitida = siguiente === undefined ? '(ninguna: es la última fase)' : `'${siguiente}'`;
  return (
    `El embudo solo avanza UN paso: de '${origen}' solo se admite ${admitida} ` +
    `(recibido '${destino}')`
  );
}

/**
 * 409 — intento de RETROCESO a una fase anterior (Etapa 9: el embudo no
 * retrocede; solo se puede descartar o avanzar).
 */
export function mensajeRetroceso(origen: Fase, destino: Fase): string {
  return (
    `El embudo solo avanza: no se puede devolver un candidato de '${origen}' a ` +
    `'${destino}'. Si necesitas revisarlo, usa el descarte con su motivo`
  );
}

/** 409 — la postulación está en un estado terminal (`contratado`/`descartado`). */
export function mensajeTerminal(estado: Estado, accion: string): string {
  return `Estado terminal: la postulación está en '${estado}' y no admite ${accion}`;
}
