import { FASES_POSTULACION, type EstadoPostulacion, type FasePostulacion } from '../tipos';

/**
 * Espejo CLIENTE de las reglas del embudo de selección (Fase 5, parte 2 +
 * Etapa 9 de la retroalimentación).
 *
 * Replica `apps/api/src/modules/embudo/postulaciones-fases.ts`: las 5 fases
 * EN ORDEN con sus NOMBRES DE LA MUESTRA (solo etiquetas de UI; las claves de
 * BD —`preseleccion`, `antecedentes`…— NO cambian) y el estado resultante
 * (`contratacion` ⇒ `contratado`). Fichero de datos PURO (sin React, sin
 * fetch) para poder testearlo en unitarios herméticos.
 *
 * SOLO AVANZA (retroalimentación Etapa 9, regla 11): desde una fase solo se
 * admite mover a la SIGUIENTE (un paso adelante); NO hay retroceso. El
 * servidor es la autoridad —`cambiarFase` responde 409 al intentar retroceder—
 * y estos helpers son un ATALLO DE UX: evitan el viaje de red cuando el
 * movimiento es obviously inválido.
 */

/** Posición de cada fase en el tablero (0-based), en el orden del ENUM de BD. */
const INDICE_FASE: Readonly<Record<FasePostulacion, number>> = {
  preseleccion: 0,
  antecedentes: 1,
  entrevistas: 2,
  proveedor_externo: 3,
  contratacion: 4,
};

/** La fase cuyo alcance es el ESTADO terminal `contratado`. */
export const FASE_CONTRATACION: FasePostulacion = 'contratacion';

/** Estados desde los que NO hay movimiento posible (sin salida). */
export const ESTADOS_TERMINALES: readonly EstadoPostulacion[] = ['contratado', 'descartado'];

/**
 * Etiqueta legible de cada fase (cabeceras de columnas, tarjetas y dashboard):
 * los NOMBRES DE LA MUESTRA («1. Recepción y Análisis de HV», …). Son SOLO
 * textos de UI — el ENUM de BD y sus claves quedan intactos.
 */
export const ETIQUETA_FASE: Readonly<Record<FasePostulacion, string>> = {
  preseleccion: 'Recepción y Análisis de HV',
  antecedentes: 'Validación de Antecedentes',
  entrevistas: 'Entrevistas y Psicotécnicas',
  proveedor_externo: 'Pruebas Proveedor Externo',
  contratacion: 'Contratación',
};

/** Etiqueta legible de cada estado (badges de las tarjetas). */
export const ETIQUETA_ESTADO_POSTULACION: Readonly<Record<EstadoPostulacion, string>> = {
  activa: 'Activa',
  contratado: 'Contratado',
  descartado: 'Descartado',
};

/** Etiqueta legible de cada acción del historial (alta/cambio/borrado). */
export const ETIQUETA_ACCION_HISTORIAL: Readonly<Record<string, string>> = {
  INSERT: 'Alta',
  UPDATE: 'Cambio',
  DELETE: 'Borrado',
};

/** Nombre legible de cada campo del historial (antes → después). */
export const ETIQUETA_CAMPO_HISTORIAL: Readonly<Record<string, string>> = {
  fase: 'Fase',
  estado: 'Estado',
  motivoDescarte: 'Motivo de descarte',
};

/** ¿`estado` es TERMINAL? Un terminal no admite cambios de fase ni descartes. */
export function esTerminal(estado: EstadoPostulacion): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

/**
 * ¿`destino` es EXACTAMENTE la fase SIGUIENTE de `origen`? El embudo SOLO
 * AVANZA (sin retroceso y sin saltos de fase).
 */
export function esSiguienteFase(origen: FasePostulacion, destino: FasePostulacion): boolean {
  return INDICE_FASE[destino] === INDICE_FASE[origen] + 1;
}

/** ¿La fase destino exige quedarse en `activa` o la vuelve `contratado`? */
export function estadoTrasMover(destino: FasePostulacion): EstadoPostulacion {
  return destino === FASE_CONTRATACION ? 'contratado' : 'activa';
}

/**
 * Mensaje LOCAL de un movimiento que no avanza UN paso — el mismo criterio que
 * el 409 del servidor, para que el usuario vea un texto consistente aunque el
 * atajo evite la llamada. Cubre retrocesos y saltos.
 */
export function mensajeSoloAvanza(origen: FasePostulacion, destino: FasePostulacion): string {
  const siguiente = FASES_POSTULACION[INDICE_FASE[origen] + 1];
  const destinoTexto =
    siguiente === undefined
      ? `'${origen}' es la fase final: no se puede avanzar más`
      : `de '${origen}' solo se admite avanzar a '${siguiente}'`;
  return `El embudo solo avanza: ${destinoTexto} (intentaste '${destino}')`;
}

/** Mensaje LOCAL de un destino igual a la fase actual (sin viaje de red). */
export function mensajeFaseActual(fase: FasePostulacion): string {
  return `La postulación ya está en la fase '${fase}': elige una fase distinta`;
}

/** Mensaje LOCAL de un intento de mover un estado terminal. */
export function mensajeTerminal(estado: EstadoPostulacion, accion: string): string {
  return `Estado terminal: la postulación está en '${estado}' y no admite ${accion}`;
}

/**
 * Mensaje LOCAL de un intento de mover a `contratación` con TODAS las plazas
 * cubiertas (regla 4 de la retroalimentación: el cupo lleno bloquea altas y
 * movimientos hacia Contratación; el servidor también responde 409).
 */
export function mensajeCupoLleno(numeroPlazas: number): string {
  return (
    `Las ${numeroPlazas} ${numeroPlazas === 1 ? 'plaza ya está' : 'plazas ya están'} ` +
    `cubiertas en este requerimiento: no se admiten movimientos a Contratación`
  );
}

/** Decisión de un drop del Kanban: mover (con ids ya validados) o ignorarlo. */
export interface DecisionSoltar {
  /** `true` si procede invocar `mover(id, fase)`; `false` si se ignora el drop. */
  procede: boolean;
  id?: string;
  fase?: FasePostulacion;
}

/**
 * Interpreta un `onDragEnd` del DndContext: decide SI hay que mover y a qué
 * fase, a partir de `active.id` (id de la tarjeta) y `over.id` (id de la
 * columna = su fase). Función PURA y testeable — es la lógica del «drop».
 *
 * Devuelve `procede: false` cuando:
 *  - el tablero no es editable (rol sin permiso o requerimiento fuera de
 *    proceso), o
 *  - el drop no cayó sobre una columna válida (`over` vacío o id desconocido).
 *
 * La validación de «SOLO AVANZA» NO vive aquí (se resuelve luego en el store,
 * que es quien decide si hace fetch o muestra «El embudo solo avanza»).
 */
export function interpretarSoltar(
  editable: boolean,
  idActivo: unknown,
  idSobre: unknown,
): DecisionSoltar {
  if (!editable) return { procede: false };
  if (typeof idActivo !== 'string' || idActivo.length === 0) return { procede: false };
  if (typeof idSobre !== 'string') return { procede: false };
  if (!(FASES_POSTULACION as readonly string[]).includes(idSobre)) return { procede: false };
  return { procede: true, id: idActivo, fase: idSobre as FasePostulacion };
}
