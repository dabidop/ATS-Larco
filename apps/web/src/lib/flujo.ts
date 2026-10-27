import type { DestinoTransicion, EstadoRequerimiento, ResultadoCierre } from '../tipos';

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
 *  - `pendiente → aprobado`   `admin_rrhh` o `superusuario` (quién aprueba: RRHH)
 *  - `pendiente → rechazado`  `admin_rrhh`/`superusuario`, o `lider_area`
 *    CREADOR (retira lo suyo)
 *  - `aprobado → en_proceso`  `admin_rrhh`/`superusuario` o `analista_seleccion`
 *  - `en_proceso → cerrado`   `admin_rrhh` o `superusuario` (quién cierra: RRHH)
 *  - `cerrado`/`rechazado`    estados TERMINALES, sin salida
 *
 * El `superusuario` (IT, migración 008, Etapa 8B) ocupa el MISMO sitio que
 * `admin_rrhh` en las 4 transiciones (segunda posición de cada lista, igual
 * que en `requerimientos-flujo.ts` del servidor).
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
  // `exitoso` es terminal y SOLO automático (el servidor lo pone al cubrir
  // las plazas): el cliente no puede pedirlo como destino de una transición.
  exitoso: [],
};

/**
 * Matriz de PERMISOS por rol (clave `origen>destino`). Una clave ausente
 * significa «ningún rol la puede ejecutar».
 */
export const PERMISOS_TRANSICION: Readonly<Partial<Record<string, readonly string[]>>> = {
  'pendiente>aprobado': ['admin_rrhh', 'superusuario'],
  'pendiente>rechazado': ['admin_rrhh', 'superusuario', 'lider_area'],
  'aprobado>en_proceso': ['admin_rrhh', 'superusuario', 'analista_seleccion'],
  'en_proceso>cerrado': ['admin_rrhh', 'superusuario'],
};

/**
 * Regla extra «cada quien retira lo suyo»: `lider_area` solo puede rechazar un
 * requerimiento QUE ÉL CREÓ; `admin_rrhh` y `superusuario` rechazan cualquier
 * solicitud (no están sujetos a la regla, igual que en el servidor).
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

/**
 * ¿El destino exige `motivo`? El rechazo lo exige el servicio y la propia BD;
 * el CIERRE también desde la Etapa 9 («cerrar» responde POR QUÉ se cierra:
 * CHECK `requerimientos_cierre_check`).
 */
export function requiereMotivo(destino: DestinoTransicion): boolean {
  return destino === 'rechazado' || destino === 'cerrado';
}

/**
 * ¿El destino exige `resultado`? SOLO `cerrado` (Etapa 9): ¿se cerró con
 * ALGUIEN CONTRATADO (`contratacion`) o se vació la plaza (`cierre_vacante`)?
 */
export function requiereResultado(destino: DestinoTransicion): boolean {
  return destino === 'cerrado';
}

/** Etiqueta legible de cada resultado del cierre (select del diálogo). */
export const ETIQUETA_RESULTADO_CIERRE: Readonly<Record<ResultadoCierre, string>> = {
  contratacion: 'Se cubrió la plaza con una contratación',
  cierre_vacante: 'Se cerró sin contratación (plaza vacante)',
};

/** Etiqueta legible de cada estado (badges y mensajes). */
export const ETIQUETA_ESTADO: Readonly<Record<EstadoRequerimiento, string>> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  en_proceso: 'En proceso',
  cerrado: 'Cerrado',
  rechazado: 'Rechazado',
  exitoso: 'Contrato exitoso',
};

/** Texto del botón de cada transición. */
export const ETIQUETA_TRANSICION: Readonly<Record<DestinoTransicion, string>> = {
  aprobado: 'Aprobar',
  en_proceso: 'Iniciar proceso',
  cerrado: 'Cerrar requerimiento',
  rechazado: 'Rechazar',
};
