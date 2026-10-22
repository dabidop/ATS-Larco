/**
 * Predicados RBAC del cliente — funciones PURAS, sin React ni fetch.
 *
 * Reflejan la matriz REAL de la API (léela en `apps/api/src`):
 *  - `AuthController`: login/ping públicos; logout/refresh/me autenticados.
 *  - `RequerimientosController`: POST @Roles('admin_rrhh','superusuario',
 *    'lider_area'); GET cualquiera autenticado; PATCH creador o
 *    admin_rrhh/superusuario (decisión del servicio);
 *    POST /:id/transiciones @Roles('admin_rrhh','superusuario',
 *    'analista_seleccion','lider_area') + matriz `origen→destino` en
 *    `requerimientos-flujo.ts`.
 *  - `CandidatosController`: POST y POST /:id/archivos
 *    @Roles('analista_seleccion','admin_rrhh','superusuario'); GET/GET
 *    historial/descarga cualquiera autenticado; PATCH creador o
 *    admin_rrhh/superusuario (servicio).
 *  - `UsuariosController` (Etapa 8B): GET/POST/PATCH de `/api/usuarios`
 *    EXCLUSIVOS de @Roles('superusuario') — RRHH NO gestiona cuentas.
 *
 * HERENCIA DEL `superusuario` (IT, migración 008): hereda TODOS los poderes de
 * `admin_rrhh` sobre el negocio (es el «4.º rol») y además es el ÚNICO rol que
 * gestiona usuarios. Cada predicado que concede algo a `admin_rrhh` concede
 * exactamente lo mismo a `superusuario`.
 *
 * ADVERTENCIA DE SEGURIDAD (también documentada en la UI): estos predicados
 * solo deciden QUÉ BOTONES SE MUESTRAN. La verdad son los guards de la API
 * (`AuthGuard` + `RolesGuard`) y las comprobaciones de servicio (creador o
 * admin). Ocultar un botón es ergonomía, nunca autorización: cualquier cliente
 * puede llamar a la API directamente y recibirá su 403.
 */

/** Roles presentes en la matriz RBAC de la API (`roles.code`), Etapa 8B. */
export const ROLES_MATRIZ = [
  'admin_rrhh',
  'analista_seleccion',
  'lider_area',
  'superusuario',
] as const;

/** ¿El rol pertenece a la matriz conocida? Defensa ante datos inesperados. */
export function esRolDeLaMatriz(rol: string | null | undefined): boolean {
  return typeof rol === 'string' && (ROLES_MATRIZ as readonly string[]).includes(rol);
}

/**
 * `admin_rrhh` o su heredero `superusuario`: en el servidor ambas acciones
 * están condicionadas por `user.role === 'admin_rrhh' || user.role ===
 * 'superusuario'` (p. ej. `requerimientos.service.ts` y `candidatos.service.ts`).
 */
function esAdministradorRRHH(rol: string | null | undefined): boolean {
  return rol === 'admin_rrhh' || rol === 'superusuario';
}

// ─────────────────────────────── Requerimientos ───────────────────────────────

/** Cualquier rol autenticado puede consultar (`GET /api/requerimientos`). */
export function puedeConsultarRequerimientos(rol: string | null | undefined): boolean {
  return esRolDeLaMatriz(rol);
}

/**
 * Crear requerimientos (`POST /api/requerimientos`): `admin_rrhh`,
 * `superusuario` y `lider_area`. Como solo esos roles crean, son también los
 * únicos que pueden ser «creador» a la hora de editar.
 */
export function puedeGestionarRequerimientos(rol: string | null | undefined): boolean {
  return esAdministradorRRHH(rol) || rol === 'lider_area';
}

/** Puerta `@Roles(...)` de `POST /:id/transiciones`; la matriz destino/rol vive en `flujo.ts`. */
export function puedeTransicionarRequerimientos(rol: string | null | undefined): boolean {
  return esRolDeLaMatriz(rol);
}

/**
 * Editar (`PATCH /:id`): «solo el creador del requerimiento o un administrador
 * de RRHH (o el `superusuario`, su heredero) pueden modificarlo» (servicio), y
 * además el estado debe ser `pendiente` (409 en otro estado).
 */
export function puedeEditarRequerimiento(
  rol: string | null | undefined,
  esCreador: boolean,
): boolean {
  return esCreador || esAdministradorRRHH(rol);
}

// ──────────────────────────────── Candidatos ────────────────────────────────

/** Cualquier rol autenticado puede consultar (`GET /api/candidatos` y su historial). */
export function puedeConsultarCandidatos(rol: string | null | undefined): boolean {
  return esRolDeLaMatriz(rol);
}

/**
 * Gestionar candidatos: crear (`POST /api/candidatos`) y subir CVs
 * (`POST /:id/archivos`) → `analista_seleccion`, `admin_rrhh` y `superusuario`.
 */
export function puedeGestionarCandidatos(rol: string | null | undefined): boolean {
  return rol === 'analista_seleccion' || esAdministradorRRHH(rol);
}

/** Editar (`PATCH /:id`): «solo el creador del candidato o un administrador de RRHH/superusuario». */
export function puedeEditarCandidato(rol: string | null | undefined, esCreador: boolean): boolean {
  return esCreador || esAdministradorRRHH(rol);
}

// ──────────────────────────── Embudo de selección ────────────────────────────

/**
 * Mover fases y descartar (`PATCH /:id/fase` y `POST /:id/descarte`):
 * `analista_seleccion`, `admin_rrhh` y `superusuario`. `lider_area` solo
 * CONSULTA el tablero (su 403 del servidor es la verdad; aquí solo se ocultan
 * los botones).
 */
export function puedeMoverPostulaciones(rol: string | null | undefined): boolean {
  return rol === 'analista_seleccion' || esAdministradorRRHH(rol);
}

/**
 * Registrar altas (`POST /api/postulaciones`): mismos roles que mover fases
 * (`@Roles('analista_seleccion','admin_rrhh','superusuario')` en el controlador).
 */
export function puedeAgregarPostulaciones(rol: string | null | undefined): boolean {
  return puedeMoverPostulaciones(rol);
}

// ─────────────────────────────── Gestión de usuarios ───────────────────────────────

/**
 * Gestionar cuentas (`GET|POST|PATCH /api/usuarios`): EXCLUSIVO de
 * `superusuario` — `admin_rrhh` NO gestiona usuarios (decisión de negocio de
 * la Etapa 8B) y recibiría 403 en la API.
 */
export function puedeGestionarUsuarios(rol: string | null | undefined): boolean {
  return rol === 'superusuario';
}

// ───────────────────────────────── Navegación ─────────────────────────────────

/**
 * El menú muestra una sección al rol si puede CONSULTARLA. Los cuatro roles de
 * la matriz pueden leer las secciones de negocio, así que la única condición
 * real de ocultación es defensiva: un rol fuera de la matriz (dato corrupto,
 * rol futuro) no ve NINGUNA sección, en lugar de asumir permisos.
 */
export function puedeVerSeccionRequerimientos(rol: string | null | undefined): boolean {
  return puedeConsultarRequerimientos(rol);
}

/** Ver sección «Candidatos» en el menú (mismo criterio defensivo). */
export function puedeVerSeccionCandidatos(rol: string | null | undefined): boolean {
  return puedeConsultarCandidatos(rol);
}

/**
 * Ver sección «Usuarios» en el menú: SOLO `superusuario` (la API devuelve 403
 * al resto, incluido `admin_rrhh`).
 */
export function puedeVerSeccionUsuarios(rol: string | null | undefined): boolean {
  return puedeGestionarUsuarios(rol);
}

/** Nombre legible de cada rol (se muestra junto al email en el header). */
export const ETIQUETA_ROL: Readonly<Record<string, string>> = {
  admin_rrhh: 'Administración RRHH',
  analista_seleccion: 'Analista de Selección',
  lider_area: 'Líder de Área',
  superusuario: 'Superusuario (IT)',
};

/** Etiqueta del rol, o el código tal cual si es desconocido. */
export function etiquetaRol(rol: string | null | undefined): string {
  if (typeof rol !== 'string' || rol.length === 0) return '';
  return ETIQUETA_ROL[rol] ?? rol;
}
