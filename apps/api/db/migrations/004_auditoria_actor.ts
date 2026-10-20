import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 004 — Auditoría del ACTOR: `audit_fila()` prioriza el GUC
 * `app.current_user_id` sobre `NEW.created_by`.
 *
 * Problema que resuelve: la función creada en 003 calculaba
 * `changed_by = COALESCE(NEW.created_by, GUC, NULL)`, pensado para INSERTs y
 * para un único escritor por fila. Con la máquina de estados (Fase 3, parte 4)
 * QUIÉN EJECUTA una transición o un `PATCH` casi nunca es el `created_by` de
 * la fila, y el `audit_log` atribuiría cada cambio al AUTOR de la solicitud:
 * un rastro falso.
 *
 * Solución en dos mitades:
 *  (a) ESTA migración reescribe `audit_fila()` con el orden de COALESCE
 *      invertido: `COALESCE(GUC app.current_user_id, NEW.created_by, NULL)`.
 *      Si la sesión fija el GUC (b) manda el actor REAL; si nadie lo fija
 *      (escrituras directas, seeds, `dataSource.query` sueltos, migraciones)
 *      sigue mandando `created_by` como hasta ahora, así que el resultado
 *      observable de 003 no cambia para esas escrituras.
 *  (b) `RequerimientosService` fija el GUC con
 *      `SELECT set_config('app.current_user_id', $1, true)` (parametrizado,
 *      NUNCA interpolando el uuid a mano) DENTRO de la transacción de la
 *      escritura, con el `sub` del JWT: transiciones Y `PATCH` de edición.
 *      `is_local = true` (equivale a `SET LOCAL`) hace que el valor muera al
 *      terminar la transacción, sin contaminar al resto del pool.
 *
 * Alcance: la función es GENÉRICA y también la usa el trigger `users_audit_log`
 * (migración 003 migró `users` a `audit_fila()`); el nuevo orden también es el
 * correcto allí (las escrituras sin GUC siguen cayendo a `created_by`/NULL).
 *
 * El `down` restaura EXACTAMENTE el cuerpo de 003 (copia literal en este
 * fichero: los ficheros de migración no se importan entre sí y 003 NO se edita
 * —ya está aplicado en todas las bases de datos—).
 *
 * Nota técnica: `CREATE OR REPLACE FUNCTION` exige firma idéntica
 * (`audit_fila()` sin argumentos, `RETURNS trigger`, `LANGUAGE plpgsql`), que
 * es exactamente la de 003; por eso `replace: true` en createFunction.
 */

/**
 * Cuerpo NUEVO (a partir de 004): PRIORIZA el GUC de sesión —el actor que
 * ejecuta la escritura— y solo en su ausencia cae a `NEW.created_by`.
 */
const AUDIT_FILA_BODY_ACTOR_PRIMERO = `DECLARE
  v_new jsonb;
  v_old jsonb;
  v_changed_by uuid;
BEGIN
  v_new := to_jsonb(NEW);
  v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_changed_by := COALESCE(
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    NULLIF(v_new ->> 'created_by', '')::uuid
  );
  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (TG_TABLE_NAME, v_new ->> 'id', TG_OP, v_old, v_new, v_changed_by);
  RETURN NEW;
END;`;

/**
 * Cuerpo ANTERIOR (versión de 003, la que restaura el `down`): PRIORIZA
 * `NEW.created_by` y usa el GUC solo como fallback. Copia literal del cuerpo
 * `AUDIT_FILA_BODY` de `003_requerimientos.ts`.
 */
const AUDIT_FILA_BODY_003 = `DECLARE
  v_new jsonb;
  v_old jsonb;
  v_changed_by uuid;
BEGIN
  v_new := to_jsonb(NEW);
  v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_changed_by := COALESCE(
    NULLIF(v_new ->> 'created_by', '')::uuid,
    NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );
  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (TG_TABLE_NAME, v_new ->> 'id', TG_OP, v_old, v_new, v_changed_by);
  RETURN NEW;
END;`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createFunction(
    'audit_fila',
    [],
    { replace: true, returns: 'trigger', language: 'plpgsql' },
    AUDIT_FILA_BODY_ACTOR_PRIMERO,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Vuelve al orden de 003 (created_by primero). Solo reescribe la función:
  // triggers, tablas y permisos no cambian, así que el `down` es un único
  // CREATE OR REPLACE.
  pgm.createFunction(
    'audit_fila',
    [],
    { replace: true, returns: 'trigger', language: 'plpgsql' },
    AUDIT_FILA_BODY_003,
  );
}
