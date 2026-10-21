import { FASES_POSTULACION, type EstadoPostulacion, type FasePostulacion } from '../tipos';

/**
 * Espejo CLIENTE de las reglas del embudo de selección (Fase 5, parte 2).
 *
 * Replica `apps/api/src/modules/embudo/postulaciones-fases.ts`: las 5 fases
 * EN ORDEN, la adyacencia (solo UN paso en cualquiera de las dos direcciones)
 * y el estado resultante (`contratacion` ⇒ `contratado`). Fichero de datos
 * PURO (sin React, sin fetch) para poder testearlo en unitarios herméticos.
 *
 * ADVERTENCIA (mismo criterio que `lib/flujo.ts`): la autoridad sigue en el
 * servidor — `PostulacionesService.cambiarFase` responde 409 si el cliente
 * calcula mal—. Estos helpers son un ATALLO DE UX: evitar un viaje de red
 * (y un rollback) cuando el movimiento es obviously inválido, p. ej. soltar
 * una tarjeta dos columnas más allá en el Kanban.
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

/** Etiqueta legible de cada fase (cabeceras de las columnas del tablero). */
export const ETIQUETA_FASE: Readonly<Record<FasePostulacion, string>> = {
  preseleccion: 'Preselección',
  antecedentes: 'Antecedentes',
  entrevistas: 'Entrevistas',
  proveedor_externo: 'Proveedor externo',
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
 * ¿`destino` está a UN solo paso de `origen`, en cualquiera de las DOS
 * direcciones? El Kanban permite regresar, pero NUNCA saltar fases.
 */
export function esAdyacente(origen: FasePostulacion, destino: FasePostulacion): boolean {
  return Math.abs(INDICE_FASE[origen] - INDICE_FASE[destino]) === 1;
}

/** ¿La fase destino exige quedarse en `activa` o la vuelve `contratado`? */
export function estadoTrasMover(destino: FasePostulacion): EstadoPostulacion {
  return destino === FASE_CONTRATACION ? 'contratado' : 'activa';
}

/** Texto de una lista de fases para los mensajes: `'a', 'b'`. */
function entrecomillar(fases: readonly FasePostulacion[]): string {
  return fases.map((fase) => `'${fase}'`).join(', ');
}

/** Fases a las que SE PUEDE mover desde `fase` (una antes y una después). */
export function fasesAdyacentes(fase: FasePostulacion): FasePostulacion[] {
  const indice = INDICE_FASE[fase];
  const adyacentes: FasePostulacion[] = [];
  const anterior = FASES_POSTULACION[indice - 1];
  const posterior = FASES_POSTULACION[indice + 1];
  if (anterior !== undefined) {
    adyacentes.push(anterior);
  }
  if (posterior !== undefined) {
    adyacentes.push(posterior);
  }
  return adyacentes;
}

/**
 * Mensaje LOCAL de un movimiento no adyacente — el mismo criterio que el 409
 * del servidor (`mensajeNoAdyacente`), para que el usuario vea un texto
 * consistente aunque el atajo evite la llamada.
 */
export function mensajeNoAdyacente(origen: FasePostulacion, destino: FasePostulacion): string {
  return (
    `Solo se puede mover un paso: de '${origen}' solo se admite ` +
    `${entrecomillar(fasesAdyacentes(origen))} (intentaste '${destino}')`
  );
}

/** Mensaje LOCAL de un destino igual a la fase actual (sin viaje de red). */
export function mensajeFaseActual(fase: FasePostulacion): string {
  return `La postulación ya está en la fase '${fase}': elige una fase distinta`;
}

/** Mensaje LOCAL de un intento de mover un estado terminal. */
export function mensajeTerminal(estado: EstadoPostulacion, accion: string): string {
  return `Estado terminal: la postulación está en '${estado}' y no admite ${accion}`;
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
 * La validación de ADYACENCIA NO vive aquí (se resuelve luego en el store,
 * que es quien decide si hace fetch o muestra «Solo se puede mover un paso»).
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
