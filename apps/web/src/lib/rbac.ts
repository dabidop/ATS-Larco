/**
 * Predicados RBAC del cliente — funciones PURAS, sin React ni fetch.
 *
 * Reflejan la matriz REAL de la API (léela en `apps/api/src`):
 *  - `AuthController`: login/ping públicos; logout/refresh/me autenticados.
 *  - `RequerimientosController`: POST @Roles('admin_rrhh','lider_area');
 *    GET cualquiera autenticado; PATCH creador o admin_rrhh (decisión del
 *    servicio); POST /:id/transiciones @Roles('admin_rrhh','analista_seleccion',
 *    'lider_area') + matriz `origen→destino` en `requerimientos-flujo.ts`.
 *  - `CandidatosController`: POST y POST /:id/archivos
 *    @Roles('analista_seleccion','admin_rrhh'); GET/GET historial/descarga
 *    cualquiera autenticado; PATCH creador o admin_rrhh (servicio).
 *
 * ADVERTENCIA DE SEGURIDAD (también documentada en la UI): estos predicados
 * solo deciden QUÉ BOTONES SE MUESTRAN. La verdad son los guards de la API
 * (`AuthGuard` + `RolesGuard`) y las comprobaciones de servicio (creador o
 * admin). Ocultar un botón es ergonomía, nunca autorización: cualquier cliente
 * puede llamar a la API directamente y recibirá su 403.
 */

/** Roles presentes en la matriz RBAC de la API (`roles.code`). */
export const ROLES_MATRIZ = ['admin_rrhh', 'analista_seleccion', 'lider_area'] as const;

/** ¿El rol pertenece a la matriz conocida? Defensa ante datos inesperados. */
export function esRolDeLaMatriz(rol: string | null | undefined): boolean {
  return typeof rol === 'string' && (ROLES_MATRIZ as readonly string[]).includes(rol);
}

// ─────────────────────────────── Requerimientos ───────────────────────────────

/** Cualquier rol autenticado puede consultar (`GET /api/requerimientos`). */
export function puedeConsultarRequerimientos(rol: string | null | undefined): boolean {
  return esRolDeLaMatriz(rol);
}

/**
 * Crear requerimientos (`POST /api/requerimientos`): `admin_rrhh` y
 * `lider_area`. Como solo esos roles crean, son también los únicos que pueden
 * ser «creador» a la hora de editar.
 */
export function puedeGestionarRequerimientos(rol: string | null | undefined): boolean {
  return rol === 'admin_rrhh' || rol === 'lider_area';
}

/** Puerta `@Roles(...)` de `POST /:id/transiciones`; la matriz destino/rol vive en `flujo.ts`. */
export function puedeTransicionarRequerimientos(rol: string | null | undefined): boolean {
  return esRolDeLaMatriz(rol);
}

/**
 * Editar (`PATCH /:id`): «solo el creador del requerimiento o un administrador
 * de RRHH pueden modificarlo» (servicio), y además el estado debe ser
 * `pendiente` (409 en otro estado).
 */
export function puedeEditarRequerimiento(
  rol: string | null | undefined,
  esCreador: boolean,
): boolean {
  return esCreador || rol === 'admin_rrhh';
}

// ──────────────────────────────── Candidatos ────────────────────────────────

/** Cualquier rol autenticado puede consultar (`GET /api/candidatos` y su historial). */
export function puedeConsultarCandidatos(rol: string | null | undefined): boolean {
  return esRolDeLaMatriz(rol);
}

/**
 * Gestionar candidatos: crear (`POST /api/candidatos`) y subir CVs
 * (`POST /:id/archivos`) → `analista_seleccion` y `admin_rrhh`.
 */
export function puedeGestionarCandidatos(rol: string | null | undefined): boolean {
  return rol === 'analista_seleccion' || rol === 'admin_rrhh';
}

/** Editar (`PATCH /:id`): «solo el creador del candidato o un administrador de RRHH». */
export function puedeEditarCandidato(rol: string | null | undefined, esCreador: boolean): boolean {
  return esCreador || rol === 'admin_rrhh';
}

// ───────────────────────────────── Navegación ─────────────────────────────────

/**
 * El menú muestra una sección al rol si puede CONSULTARLA. Los tres roles de la
 * matriz pueden leer ambas, así que la única condición real de ocultación es
 * defensiva: un rol fuera de la matriz (dato corrupto, rol futuro) no ve
 * NINGUNA sección, en lugar de asumir permisos.
 */
export function puedeVerSeccionRequerimientos(rol: string | null | undefined): boolean {
  return puedeConsultarRequerimientos(rol);
}

/** Ver sección «Candidatos» en el menú (mismo criterio defensivo). */
export function puedeVerSeccionCandidatos(rol: string | null | undefined): boolean {
  return puedeConsultarCandidatos(rol);
}

/** Nombre legible de cada rol (se muestra junto al email en el header). */
export const ETIQUETA_ROL: Readonly<Record<string, string>> = {
  admin_rrhh: 'Administración RRHH',
  analista_seleccion: 'Analista de Selección',
  lider_area: 'Líder de Área',
};

/** Etiqueta del rol, o el código tal cual si es desconocido. */
export function etiquetaRol(rol: string | null | undefined): string {
  if (typeof rol !== 'string' || rol.length === 0) return '';
  return ETIQUETA_ROL[rol] ?? rol;
}
