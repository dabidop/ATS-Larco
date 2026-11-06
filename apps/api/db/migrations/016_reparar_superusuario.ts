import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 016 — Reparación del invariante «siempre existe un superusuario activo».
 *
 * Contexto: el 03/11/2026 la cuenta semilla de IT (`it@larco.co`, creada por la
 * migración 008) apareció en la BD de desarrollo con `role_id` de
 * `admin_rrhh`. Consecuencia: al iniciar sesión, `POST /api/auth/login`
 * devolvía `role: "admin_rrhh"`, el menú del frontend ocultaba «Bitácora» y
 * «Usuarios» (predicados de `lib/rbac.ts`) y la API respondía 403 en
 * `/api/historial/auditoria`. Como la propia regla de `UsuariosService`
 * impide quitar el rol al último superusuario activo, la cuenta quedó en un
 * estado que ya NO se puede reparar desde la interfaz: hace falta SQL.
 *
 * Esta migración devuelve el sistema a un estado válido y es IDEMPOTENTE:
 *  1. Si ya hay al menos un superusuario activo, no toca nada (una bajada
 *     deliberada del rol no se revierte por accidente).
 *  2. Si no hay ninguno, asciende la cuenta semilla (`SUPER_INITIAL_EMAIL`,
 *     por defecto `it@larco.co`) al rol `superusuario`.
 *  3. Verifica al final que el invariante se cumple; si no, aborta ruidoso.
 *
 * No crea usuarios ni roles: la 008 ya lo hace. Esto solo corrige el `role_id`.
 */

const SUPER_EMAIL = process.env.SUPER_INITIAL_EMAIL?.trim() || 'it@larco.co';
const SUPER_ROLE_CODE = 'superusuario';
const ADMIN_ROLE_CODE = 'admin_rrhh';

/** Escapa un valor para usarlo dentro de un literal SQL estándar ('...'). */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
DO $migrate$
DECLARE
  v_superusuarios_activos int;
  v_usuario_id uuid;
BEGIN
  SELECT count(*)::int
    INTO v_superusuarios_activos
    FROM users u
    JOIN roles r ON r.id = u.role_id
   WHERE r.code = ${sqlLiteral(SUPER_ROLE_CODE)}
     AND u.active;

  IF v_superusuarios_activos > 0 THEN
    RAISE NOTICE '016: ya existen % superusuario(s) activo(s); no se modifica ninguna cuenta', v_superusuarios_activos;
    RETURN;
  END IF;

  SELECT id INTO v_usuario_id
    FROM users
   WHERE lower(email) = lower(${sqlLiteral(SUPER_EMAIL)});

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION '016: no hay ningún superusuario activo y la cuenta semilla % no existe. Ejecuta las migraciones 002/008 o define SUPER_INITIAL_EMAIL', ${sqlLiteral(SUPER_EMAIL)};
  END IF;

  UPDATE users
     SET role_id = (SELECT id FROM roles WHERE code = ${sqlLiteral(SUPER_ROLE_CODE)})
   WHERE id = v_usuario_id
     AND active;

  IF NOT FOUND THEN
    RAISE EXCEPTION '016: la cuenta semilla % existe pero está INACTIVA; actívala antes de reparar el rol', ${sqlLiteral(SUPER_EMAIL)};
  END IF;

  RAISE NOTICE '016: rol superusuario restaurado en %', ${sqlLiteral(SUPER_EMAIL)};
END
$migrate$
`);

  // Verificación dura: el sistema NUNCA debe quedar sin IT.
  pgm.sql(`
DO $migrate$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM users u
      JOIN roles r ON r.id = u.role_id
     WHERE r.code = ${sqlLiteral(SUPER_ROLE_CODE)}
       AND u.active
  ) THEN
    RAISE EXCEPTION '016: sigue sin haber superusuarios activos; la reparación no surtió efecto';
  END IF;
END
$migrate$
`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Se revierte SOLO si con ello no se deja al sistema sin IT. Si la cuenta
  // reparada es el único superusuario activo, el `down` no hace nada: volver a
  // `admin_rrhh` reproduciría exactamente el bloqueo que esta migración corrige.
  pgm.sql(`
DO $migrate$
DECLARE
  v_otros_superusuarios int;
  v_usuario_id uuid;
BEGIN
  SELECT id INTO v_usuario_id
    FROM users
   WHERE lower(email) = lower(${sqlLiteral(SUPER_EMAIL)});

  IF v_usuario_id IS NULL THEN
    RAISE NOTICE '016 down: no existe %; nada que revertir', ${sqlLiteral(SUPER_EMAIL)};
    RETURN;
  END IF;

  SELECT count(*)::int
    INTO v_otros_superusuarios
    FROM users u
    JOIN roles r ON r.id = u.role_id
   WHERE r.code = ${sqlLiteral(SUPER_ROLE_CODE)}
     AND u.active
     AND u.id <> v_usuario_id;

  IF v_otros_superusuarios = 0 THEN
    RAISE NOTICE '016 down: % es el único superusuario activo; se conserva el rol para no bloquear el sistema', ${sqlLiteral(SUPER_EMAIL)};
    RETURN;
  END IF;

  UPDATE users
     SET role_id = (SELECT id FROM roles WHERE code = ${sqlLiteral(ADMIN_ROLE_CODE)})
   WHERE id = v_usuario_id;
END
$migrate$
`);
}
