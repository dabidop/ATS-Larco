/**
 * Forma PÚBLICA de un usuario tal y como sale por la API (camelCase).
 *
 * Es la contraparte de la tabla `users` (snake_case en BD, migración 001).
 *
 * QUÉ NUNCA SALE por la API: `password_hash`. El SELECT del servicio pide
 * columnas EXPLÍCITAS (nunca `*`), así que el hash ni siquiera se lee en las
 * consultas de este módulo; tampoco `role_id`, `updated_at` ni ningún otro
 * control interno. El cliente solo ve lo declarado aquí abajo.
 */

/**
 * Fila de LECTURA (`users` JOIN `roles`) tal y como la devuelve `pg`.
 *
 * Se declara como `type` (y no `interface`) a propósito: `pg` exige
 * `T extends QueryResultRow`, es decir, un tipo con firma de índice; las
 * `interface` NO la reciben y los `type` de objeto sí (mismo criterio que
 * `PostulacionFilaCruda`).
 */
export type UsuarioFila = {
  id: string;
  /** `users.full_name`. */
  nombre: string;
  email: string;
  /** `roles.code` (p. ej. `admin_rrhh`). */
  rol: string;
  /** `roles.name` (p. ej. `Administrador RRHH`). */
  rol_nombre: string;
  activo: boolean;
  /** `timestamptz` llega desde `pg` como `Date`. */
  creado_en: Date;
};

export interface UsuarioResponseDto {
  id: string;
  nombre: string;
  email: string;
  /** Código del rol (fuente de verdad para el RBAC). */
  rol: string;
  /** Nombre legible del rol (para pintar la tabla sin resolver el código). */
  rolNombre: string;
  activo: boolean;
  /** ISO 8601 (UTC). */
  creadoEn: string;
}

/** Respuesta paginada de `GET /api/usuarios`. */
export interface UsuariosPageDto {
  items: UsuarioResponseDto[];
  /** Total de filas que cumplen el filtro (independiente de la página). */
  total: number;
  page: number;
  limit: number;
}

/**
 * Columnas de LECTURA con alias: el SQL jamás usa `*` ni selecciona
 * `password_hash`, de modo que ninguna columna futura de `users` se cuela en
 * la respuesta hasta que se decida aquí cómo presentarla.
 */
export const COLUMNAS_USUARIO = `
  u.id,
  u.full_name AS nombre,
  u.email,
  r.code AS rol,
  r.name AS rol_nombre,
  u.active AS activo,
  u.created_at AS creado_en
`;

/** Fila de BD → respuesta pública (función PURA: se testea sin BD). */
export function toUsuarioResponse(fila: UsuarioFila): UsuarioResponseDto {
  return {
    id: fila.id,
    nombre: fila.nombre,
    email: fila.email,
    rol: fila.rol,
    rolNombre: fila.rol_nombre,
    activo: fila.activo,
    creadoEn: new Date(fila.creado_en).toISOString(),
  };
}
