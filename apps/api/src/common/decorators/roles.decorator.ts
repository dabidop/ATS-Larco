import { SetMetadata } from '@nestjs/common';

/**
 * Códigos de rol admitidos por el RBAC (equivalentes a `roles.code` en la
 * base de datos). Se verifica antes de escribirlo: `@ats/shared` todavía no
 * expone ningún enum/tipo de roles, así que se define aquí, en la capa de
 * decoradores comunes, y se reexporta a los controladores desde este archivo.
 *
 * `superusuario` (IT, migración 008) gestiona los usuarios Y hereda TODOS los
 * permisos de `admin_rrhh` sobre el negocio: cada sitio que hoy concede poder
 * a `admin_rrhh` concede también a `superusuario` (matriz Etapa 8B). RRHH NO
 * gestiona usuarios: `/api/usuarios` es EXCLUSIVO de `superusuario`.
 */
export type RoleCode = 'admin_rrhh' | 'superusuario' | 'analista_seleccion' | 'lider_area';

/** Clave de metadatos con la lista de roles permitidos (usada por RolesGuard). */
export const ROLES_KEY = 'rolesPermitidos';

/**
 * Restringe una ruta a los roles indicados: exige autenticación (siempre) y
 * que `request.user.role` pertenezca a la lista; si no → 403.
 *
 * Sin `@Roles(...)` la ruta solo requiere estar autenticada (cualquier rol).
 */
export const Roles = (...codes: RoleCode[]) => SetMetadata(ROLES_KEY, codes);
