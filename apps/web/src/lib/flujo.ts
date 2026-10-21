import type { DestinoTransicion, EstadoRequerimiento } from '../tipos';

/**
 * Espejo CLIENTE de la máquina de estados de requerimientos.
 *
 * La API NO expone un `GET /requerimientos/:id/transiciones` (se comprobó en
 * `apps/api/src/modules/requerimientos/requerimientos.controller.ts`: solo
 * existe `POST /:id/transiciones`), así que las opciones disponibles se
 * calculan aquí replicando EXACTAMENTE
 * `apps/api/src/modules/requerimientos/requerimientos-flujo.ts`:
 *
 *  pendiente → aprobado → en_proceso → cerrado | rechazado
 *  - `pendiente → aprobado`   solo `admin_rrhh` (quién aprueba: RRHH)
 *  - `pendiente → rechazado`  `admin_rrhh` o `lider_area` CREADOR (retira lo suyo)
 *  - `aprobado → en_proceso`  `admin_rrhh` o `analista_seleccion`
 *  - `en_proceso → cerrado`   solo `admin_rrhh` (quién cierra: RRHH)
 *  - `cerrado`/`rechazado`    estados TERMINALES, sin salida
 *
 * SINCRONÍA: si la API cambia su matriz, hay que cambiarla AQUÍ. Aun así la
 * autoridad sigue siendo el servidor (el servicio responde 409/403 si el
 * cliente calcula mal); estos helpers solo deciden qué botones mostrar.
 */

/** Transiciones ESTRUCTURALMENTE válidas desde cada estado. */
export const TRANSICIONES_VALIDAS: Readonly<
  Record<EstadoRequerimiento, readonly DestinoTransicion[]>
> = {
  pendiente: ['aprobado', 'rechazado'],
  aprobado: ['en_proceso'],
  en_proceso: ['cerrado'],
  cerrado: [],
  rechazado: [],
};

/**
 * Matriz de PERMISOS por rol (clave `origen>destino`). Una clave ausente
 * significa «ningún rol la puede ejecutar».
 */
export const PERMISOS_TRANSICION: Readonly<Partial<Record<string, readonly string[]>>> = {
  'pendiente>aprobado': ['admin_rrhh'],
  'pendiente>rechazado': ['admin_rrhh', 'lider_area'],
  'aprobado>en_proceso': ['admin_rrhh', 'analista_seleccion'],
  'en_proceso>cerrado': ['admin_rrhh'],
};

/**
 * Regla extra «cada quien retira lo suyo»: `lider_area` solo puede rechazar un
 * requerimiento QUE ÉL CREÓ; `admin_rrhh` rechaza cualquier solicitud.
 */
const REQUIERE_SER_CREADOR: Readonly<Partial<Record<string, readonly string[]>>> = {
  'pendiente>rechazado': ['lider_area'],
};

/** ¿La transición es válida ESTRUCTURALMENTE desde `origen`? */
export function esTransicionValida(
  estado: EstadoRequerimiento,
  destino: DestinoTransicion,
): boolean {
  return TRANSICIONES_VALIDAS[estado].includes(destino);
}

/**
 * Destinos que el rol PUEDE ejecutar desde `estado` (matriz + regla del
 * creador). Es la lista que pinta los botones del detalle.
 */
export function transicionesPermitidas(
  estado: EstadoRequerimiento,
  rol: string | null | undefined,
  esCreador: boolean,
): DestinoTransicion[] {
  if (typeof rol !== 'string') return [];
  return TRANSICIONES_VALIDAS[estado].filter((destino) => {
    const clave = `${estado}>${destino}`;
    if (!(PERMISOS_TRANSICION[clave] ?? []).includes(rol)) return false;
    if ((REQUIERE_SER_CREADOR[clave] ?? []).includes(rol) && !esCreador) return false;
    return true;
  });
}

/** El rechazo exige `motivo` (lo exige el servicio y la propia BD). */
export function requiereMotivo(destino: DestinoTransicion): boolean {
  return destino === 'rechazado';
}

/** Etiqueta legible de cada estado (badges y mensajes). */
export const ETIQUETA_ESTADO: Readonly<Record<EstadoRequerimiento, string>> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  en_proceso: 'En proceso',
  cerrado: 'Cerrado',
  rechazado: 'Rechazado',
};

/** Texto del botón de cada transición. */
export const ETIQUETA_TRANSICION: Readonly<Record<DestinoTransicion, string>> = {
  aprobado: 'Aprobar',
  en_proceso: 'Iniciar proceso',
  cerrado: 'Cerrar requerimiento',
  rechazado: 'Rechazar',
};
