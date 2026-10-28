import type { MigrationBuilder } from 'node-pg-migrate';

// Import en TIEMPO DE EJECUCIÓN desde el código de la app (mismo patrón que
// la 002: los ficheros de `apps/api/db/**` no forman parte del tsconfig de la
// API a propósito; jiti transpila TS al cargar la migración). `password.util`
// solo depende de `node:crypto`, sin decoradores ni módulos de Nest.
import { hashPassword } from '../../src/common/crypto/password.util';

/**
 * 008 — Rol `superusuario` (IT) y su primer usuario.
 *
 * Contexto de negocio: RRHH NO administra el software; IT sí. El superusuario
 * es el encargado de dar de alta a los usuarios de administración de RRHH,
 * analistas y líderes (gestión de cuentas, roles y contraseñas), y además
 * hereda TODO el poder de `admin_rrhh` sobre el negocio (aprobar, cerrar,
 * embudo, candidatos) — decisión tomada con el usuario el 22/10/2026.
 *
 * Contenido (determinista, patrón idéntico a la 002):
 *  1. Fila en `roles`: code `superusuario`, name `Superusuario (IT)`.
 *  2. Primer usuario superusuario: `it@larco.co` con hash scrypt de la
 *     variable de entorno `SUPER_INITIAL_PASSWORD` (obligatoria; fallo
 *     ruidoso si falta, igual que `ADMIN_INITIAL_PASSWORD` en la 002).
 *  3. Verificación dura de que AMBAS filas existen al terminar.
 *
 * El hash se calcula una sola vez, aquí. El trigger `users_audit_log` audita
 * estas escrituras con `changed_by = NULL` (INSERT de migración sin GUC de
 * actor), igual que en la 002.
 *
 * `down` elimina el usuario y el rol con la misma coreografía que la 002
 * (deshabilitar `audit_log_no_mutation` dentro de la transacción, porque el
 * `ON DELETE SET NULL` de `audit_log.changed_by` haría un UPDATE interno que
 * el trigger de inmutabilidad rechazaría).
 */

const SUPER_EMAIL = process.env.SUPER_INITIAL_EMAIL?.trim() || 'it@larco.co';
const SUPER_FULL_NAME = process.env.SUPER_INITIAL_NAME?.trim() || 'Superusuario IT';
const SUPER_ROLE_CODE = 'superusuario';
const SUPER_ROLE_NAME = 'Superusuario (IT)';

/** Escapa un valor para usarlo dentro de un literal SQL estándar ('...'). */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function up(pgm: MigrationBuilder): Promise<void> {
  const plainPassword = process.env.SUPER_INITIAL_PASSWORD;
  if (!plainPassword) {
    throw new Error(
      [
        'Falta la variable de entorno SUPER_INITIAL_PASSWORD, obligatoria para',
        'generar el hash de la contraseña del primer superusuario (IT).',
        'Solución: defínela en el fichero .env de la RAÍZ del repositorio',
        '(nunca se versiona), p. ej.:',
        '    SUPER_INITIAL_PASSWORD=<contraseña-fuerte>',
        'y vuelve a ejecutar: pnpm --filter @ats/api db:migrate',
      ].join('\n'),
    );
  }

  // scrypt es deliberadamente lento: el hash se calcula una sola vez, aquí.
  const passwordHash = await hashPassword(plainPassword);

  pgm.sql(`
INSERT INTO roles (code, name)
VALUES (${sqlLiteral(SUPER_ROLE_CODE)}, ${sqlLiteral(SUPER_ROLE_NAME)})
`);

  pgm.sql(`
INSERT INTO users (role_id, email, password_hash, full_name, active)
SELECT r.id, ${sqlLiteral(SUPER_EMAIL)}, ${sqlLiteral(passwordHash)}, ${sqlLiteral(SUPER_FULL_NAME)}, true
FROM roles r
WHERE r.code = ${sqlLiteral(SUPER_ROLE_CODE)}
`);

  // Verificación dura: si el rol o el usuario no se insertaron, el seed está
  // roto y la migración debe fallar de forma ruidosa.
  pgm.sql(`
DO $migrate$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roles WHERE code = ${sqlLiteral(SUPER_ROLE_CODE)}) THEN
    RAISE EXCEPTION 'El rol superusuario no pudo insertarse; la migración 008 está incompleta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = ${sqlLiteral(SUPER_EMAIL)}) THEN
    RAISE EXCEPTION 'El usuario superusuario (%) no pudo insertarse; la migración 008 está incompleta', ${sqlLiteral(SUPER_EMAIL)};
  END IF;
END
$migrate$
`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Orden importa: primero usuarios (FK -> roles), luego roles. Mismo baile
  // del trigger de inmutabilidad que en la 002 (ON DELETE SET NULL sobre
  // audit_log haría un UPDATE que `audit_log_no_mutation` rechazaría).
  pgm.sql('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutation');
  pgm.sql(`DELETE FROM users WHERE email = ${sqlLiteral(SUPER_EMAIL)}`);
  pgm.sql(`DELETE FROM roles WHERE code = ${sqlLiteral(SUPER_ROLE_CODE)}`);
  pgm.sql('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_mutation');
}
