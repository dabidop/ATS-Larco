import type { MigrationBuilder } from 'node-pg-migrate';

// Import en TIEMPO DE EJECUCIÓN desde el código de la app (los ficheros de
// `apps/api/db/**` no forman parte del tsconfig de la API a propósito; jiti
// transpila TS al cargar la migración). `password.util` solo depende de
// `node:crypto`, sin decoradores ni módulos de Nest.
import { hashPassword } from '../../src/common/crypto/password.util';

/**
 * 002 — Seed determinista: roles base + usuario administrador inicial.
 *
 * El contenido es determinista (mismos códigos, mismo email en cada ejecución),
 * pero NO usa ON CONFLICT: si los datos ya existen, la migración falla de forma
 * ruidosa en lugar de silenciar un estado inconsistente.
 */

const ADMIN_EMAIL = process.env.ADMIN_INITIAL_EMAIL?.trim() || 'admin@larco.co';
const ADMIN_FULL_NAME = process.env.ADMIN_INITIAL_NAME?.trim() || 'Administrador RRHH';
const ADMIN_ROLE_CODE = 'admin_rrhh';

const ROLES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'admin_rrhh', name: 'Administrador RRHH' },
  { code: 'analista_seleccion', name: 'Analista de Selección' },
  { code: 'lider_area', name: 'Líder de Área' },
];

/**
 * `pgm.sql()` añade el `;` final, así que los literales NO lo llevan (evita
 * sentencias vacías en el SQL emitido).
 */

/** Escapa un valor para usarlo dentro de un literal SQL estándar ('...'). */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function up(pgm: MigrationBuilder): Promise<void> {
  const plainPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!plainPassword) {
    throw new Error(
      [
        'Falta la variable de entorno ADMIN_INITIAL_PASSWORD, obligatoria para',
        'generar el hash de la contraseña del usuario admin inicial.',
        'Solución: defínela en el fichero .env de la RAÍZ del repositorio',
        '(nunca se versiona), p. ej.:',
        '    ADMIN_INITIAL_PASSWORD=<contraseña-fuerte>',
        'y vuelve a ejecutar: pnpm --filter @ats/api db:migrate',
      ].join('\n'),
    );
  }

  // scrypt es deliberadamente lento: el hash se calcula una sola vez, aquí.
  const passwordHash = await hashPassword(plainPassword);

  const roleValues = ROLES.map(
    (role) => `  (${sqlLiteral(role.code)}, ${sqlLiteral(role.name)})`,
  ).join(',\n');

  pgm.sql(`
INSERT INTO roles (code, name)
VALUES
${roleValues}
`);

  pgm.sql(`
INSERT INTO users (role_id, email, password_hash, full_name, active)
SELECT r.id, ${sqlLiteral(ADMIN_EMAIL)}, ${sqlLiteral(passwordHash)}, ${sqlLiteral(ADMIN_FULL_NAME)}, true
FROM roles r
WHERE r.code = ${sqlLiteral(ADMIN_ROLE_CODE)}
`);

  // Verificación dura: si el admin no se insertó, el seed está roto.
  pgm.sql(`
DO $migrate$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = ${sqlLiteral(ADMIN_EMAIL)}) THEN
    RAISE EXCEPTION 'El usuario admin inicial (%) no pudo insertarse; la migración 002 está incompleta', ${sqlLiteral(ADMIN_EMAIL)};
  END IF;
END
$migrate$
`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Orden importa: primero usuarios (FK -> roles), luego roles.
  //
  // ATENCIÓN: `audit_log.changed_by` tiene `ON DELETE SET NULL`, es decir,
  // borrar un usuario provoca un UPDATE INTERNO sobre `audit_log` que el
  // trigger `audit_log_no_mutation` rechazaría (eso es intencionado: la tabla
  // es inmutable para todo cliente). La migración corre dentro de una
  // transacción única, así que deshabilitamos el trigger SOLO aquí dentro y lo
  // re-habilitamos al final: el histórico de auditoría se conserva con
  // `changed_by = NULL`, que es exactamente el semántica del ON DELETE SET NULL.
  pgm.sql('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutation');
  pgm.sql(`DELETE FROM users WHERE email = ${sqlLiteral(ADMIN_EMAIL)}`);
  pgm.sql(`DELETE FROM roles WHERE code IN (${ROLES.map((r) => sqlLiteral(r.code)).join(', ')})`);
  pgm.sql('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_mutation');
}
