import type { RoleCode } from '../../common/decorators/roles.decorator';
import { EstadoRequerimiento } from './requerimiento.entity';

/**
 * Máquina de estados del flujo de requerimientos con permisos por rol
 * (Fase 3, parte 4).
 *
 * Fichero de DATOS puros: sin BD, sin Nest, sin I/O — se puede testear en
 * unitarios herméticos y consultar desde el servicio.
 *
 * Flujo: `pendiente → aprobado → en_proceso → cerrado | rechazado`
 *  - `pendiente → aprobado`   QUIÉN APRUEBA: RRHH (`admin_rrhh`).
 *  - `pendiente → rechazado`  RRHH, o el líder sobre SU propia solicitud.
 *  - `aprobado → en_proceso`  RRHH o el analista de selección que lo ejecuta.
 *  - `en_proceso → cerrado`   QUIÉN CIERRA: RRHH (`admin_rrhh`).
 *  - `cerrado` y `rechazado`  son estados TERMINALES (sin salida).
 *
 * El ORDEN de las claves de `TRANSICIONES_VALIDAS` replica el orden del ENUM
 * `estado_requerimiento` de PostgreSQL (migración 003).
 */

/** Clave de matriz `"origen>destino"` para los 5 × 5 pares de estados. */
export type ClaveTransicion = `${EstadoRequerimiento}>${EstadoRequerimiento}`;

/**
 * Transiciones ESTRUCTURALMENTE válidas por estado (qué se puede hacer desde
 * cada estado, con independencia de quién lo pida). Los estados terminales
 * (`cerrado`, `rechazado`) apuntan a `[]`: sin salida.
 */
export const TRANSICIONES_VALIDAS: Readonly<
  Record<EstadoRequerimiento, readonly EstadoRequerimiento[]>
> = {
  [EstadoRequerimiento.Pendiente]: [EstadoRequerimiento.Aprobado, EstadoRequerimiento.Rechazado],
  [EstadoRequerimiento.Aprobado]: [EstadoRequerimiento.EnProceso],
  [EstadoRequerimiento.EnProceso]: [EstadoRequerimiento.Cerrado],
  [EstadoRequerimiento.Cerrado]: [],
  [EstadoRequerimiento.Rechazado]: [],
};

/**
 * Matriz de PERMISOS por rol: qué roles pueden ejecutar cada transición.
 *
 * `Partial<Record<ClaveTransicion, ...>>` a propósito: un `Record` completo
 * sobre la plantilla `origen>destino` exigiría las 25 combinaciones (5 × 5),
 * incluidas las imposibles (`pendiente > en_proceso`, `rechazado > cerrado`…).
 * Solo las 4 transiciones VÁLIDAS tienen entrada; una clave ausente significa
 * "ningún rol la puede ejecutar" (el servicio responde 403 si acaso llega allí
 * tras el 409 estructural, que se evalúa primero).
 *
 * | Transición                | Roles                                    |
 * |---------------------------|------------------------------------------|
 * | `pendiente>aprobado`      | admin_rrhh (quién aprueba: RRHH)         |
 * | `pendiente>rechazado`     | admin_rrhh, lider_area (+ regla creador) |
 * | `aprobado>en_proceso`     | admin_rrhh, analista_seleccion           |
 * | `en_proceso>cerrado`      | admin_rrhh (quién cierra: RRHH)          |
 */
export const PERMISOS_TRANSICION: Readonly<Partial<Record<ClaveTransicion, readonly RoleCode[]>>> =
  {
    'pendiente>aprobado': ['admin_rrhh'],
    'pendiente>rechazado': ['admin_rrhh', 'lider_area'],
    'aprobado>en_proceso': ['admin_rrhh', 'analista_seleccion'],
    'en_proceso>cerrado': ['admin_rrhh'],
  };

/**
 * REGLA EXTRA — "cada quien retira lo suyo": el rol `lider_area` solo puede
 * ejecutar `pendiente → rechazado` sobre un requerimiento QUE ÉL CREÓ
 * (`created_by === user.sub`), es decir, puede RETIRAR SU SOLICITUD pero no
 * vetar la de otro líder. `admin_rrhh` no está sujeta a esta regla: RRHH
 * rechaza cualquier solicitud.
 *
 * La lista contiene los roles de `clave` a los que se les exige ser creador;
 * si el rol no está en la lista, la transición no exige autoría.
 */
const REQUIERE_SER_CREADOR: Readonly<Partial<Record<ClaveTransicion, readonly RoleCode[]>>> = {
  'pendiente>rechazado': ['lider_area'],
};

/** ¿`destino` es una transición estructuralmente válida desde `origen`? */
export function esTransicionValida(
  origen: EstadoRequerimiento,
  destino: EstadoRequerimiento,
): boolean {
  return TRANSICIONES_VALIDAS[origen].includes(destino);
}

/**
 * Motivo de DENEGACIÓN en español, o `null` si la transición está permitida.
 *
 * Combina las dos capas de autorización: (1) el rol debe estar en
 * `PERMISOS_TRANSICION` para esa transición; (2) si la transición aplica la
 * regla del creador a ese rol, el usuario debe ser el autor de la solicitud.
 * El mensaje nombra SIEMPRE el rol y la transición (útil para el 403 del API
 * y para testear el texto en unitarios).
 */
export function denegacionPermiso(
  origen: EstadoRequerimiento,
  destino: EstadoRequerimiento,
  role: string,
  esCreador: boolean,
): string | null {
  const clave: ClaveTransicion = `${origen}>${destino}`;
  const permitidos = PERMISOS_TRANSICION[clave] ?? [];
  const codigoRol = role as RoleCode;

  if (!permitidos.includes(codigoRol)) {
    const detalle =
      permitidos.length === 0
        ? 'ningún rol la tiene habilitada'
        : `roles permitidos: ${permitidos.join(', ')}`;
    return `Tu rol '${role}' no está autorizado para la transición ${origen} → ${destino} (${detalle})`;
  }

  if ((REQUIERE_SER_CREADOR[clave] ?? []).includes(codigoRol) && !esCreador) {
    return (
      `Solo el creador del requerimiento puede ejecutar ${origen} → ${destino} ` +
      `con el rol '${role}': un líder solo puede retirar SU propia solicitud`
    );
  }

  return null;
}

/**
 * ¿Puede `role` llevar el requerimiento de `origen` a `destino` siendo (o no)
 * el creador? Combina la validez ESTRUCTURAL de la transición con la matriz de
 * permisos (incluida la regla del creador). Helper puro para tests unitarios.
 */
export function puedeTransitar(
  origen: EstadoRequerimiento,
  destino: EstadoRequerimiento,
  role: RoleCode,
  esCreador: boolean,
): boolean {
  return (
    esTransicionValida(origen, destino) &&
    denegacionPermiso(origen, destino, role, esCreador) === null
  );
}

/**
 * Transiciones que `role` PUEDE ejecutar desde `estado` (respetando la regla
 * del creador): la lista para "¿qué opciones me quedan?" y para testear la
 * máquina estado por estado. Orden = orden de `TRANSICIONES_VALIDAS[estado]`.
 */
export function transicionesPermitidas(
  estado: EstadoRequerimiento,
  role: RoleCode,
  esCreador: boolean,
): EstadoRequerimiento[] {
  return TRANSICIONES_VALIDAS[estado].filter((destino) =>
    puedeTransitar(estado, destino, role, esCreador),
  );
}
