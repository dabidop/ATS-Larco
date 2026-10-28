import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 011 — Correcciones de la ronda posterior a la Etapa 9.
 *
 * Tres cambios sobre el esquema:
 *
 *  1. `users.jefatura` (TEXT, nullable): jefatura a la que pertenece un
 *     `lider_area`. «Líder por cada jefatura»: un líder solo debe ver lo de SU
 *     área, así que `RequerimientosService.list` filtra por esta columna cuando
 *     el rol es `lider_area`. Es TEXTO libre —igual que `requerimientos.jefatura`—
 *     y NO es una FK: las jefaturas son etiquetas de negocio que ya viven como
 *     texto en `requerimientos`, y aquí solo se compara por igualdad exacta.
 *     NULL = líder SIN área asignada (corte de seguridad: en ese caso el
 *     servicio mantiene el filtro anterior, `created_by = él`, para no dejarle
 *     a ciegas ni darle de más).
 *
 *  2. `audit_fila()` se vuelve consciente de **DELETE**: antes calculaba
 *     `to_jsonb(NEW)` sin más, y en un trigger de borrado `NEW` es NULL →
 *     `record_id` (NOT NULL) y `changed_by` saldrían vacíos. El cuerpo nuevo:
 *      - `v_new` es NULL en DELETE y `v_old` es NULL en INSERT (ya lo era);
 *      - `record_id = COALESCE(new.id, old.id)`: en un borrado la identidad
 *        vive en `OLD`;
 *      - el fallback del actor mira `created_by` de `NEW` y, en DELETE, el de
 *        `OLD`;
 *      - `RETURN NULL` en DELETE (los triggers que usan esta función son todos
 *        AFTER ROW: el valor de retorno se ignora, pero así no se intenta
 *        devolver un registro NULL).
 *     Comportamiento VISIBLE de INSERT/UPDATE intacto: el nuevo fallback sobre
 *     `OLD.created_by` solo se alcanza cuando `NEW` no existe.
 *
 *  3. El trigger `candidatos_audit_log` pasa a `['INSERT','UPDATE','DELETE']`
 *     para que el borrado de un candidato (`DELETE /api/candidatos/:id`) deje
 *     rastro en la bitácora como cualquier otra escritura.
 *
 * `down()`: restaura el cuerpo de `audit_fila` de la migración 004 (copia
 * literal, los ficheros de migración no se importan entre sí), quita DELETE del
 * trigger de `candidatos` y elimina `users.jefatura`.
 */

/**
 * Cuerpo NUEVO (a partir de 011): mismo orden de COALESCE que 004 (GUC del
 * actor primero) pero tolerante a DELETE.
 */
const AUDIT_FILA_BODY_CON_DELETE = `DECLARE
  v_new jsonb;
  v_old jsonb;
  v_changed_by uuid;
BEGIN
  v_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_changed_by := COALESCE(
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    NULLIF(v_new ->> 'created_by', '')::uuid,
    NULLIF(v_old ->> 'created_by', '')::uuid
  );
  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(v_new ->> 'id', v_old ->> 'id'),
    TG_OP,
    v_old,
    v_new,
    v_changed_by
  );
  IF TG_OP = 'DELETE' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;`;

/**
 * Cuerpo ANTERIOR (versión de 004, la que restaura el `down`): copia literal de
 * `AUDIT_FILA_BODY_ACTOR_PRIMERO` de `004_auditoria_actor.ts`.
 */
const AUDIT_FILA_BODY_004 = `DECLARE
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

export async function up(pgm: MigrationBuilder): Promise<void> {
  // 1) Jefatura del líder (nullable: un líder puede existir sin área asignada).
  pgm.addColumn('users', { jefatura: { type: 'text', notNull: false } });

  // 2) `audit_fila()` consciente de DELETE (misma firma: REPLACE permitido).
  pgm.createFunction(
    'audit_fila',
    [],
    { replace: true, returns: 'trigger', language: 'plpgsql' },
    AUDIT_FILA_BODY_CON_DELETE,
  );

  // 3) `candidatos` audita también el borrado (los triggers de 005 eran
  //    INSERT/UPDATE). DROP + CREATE: `createTrigger` no tiene «OR REPLACE».
  pgm.dropTrigger('candidatos', 'candidatos_audit_log');
  pgm.createTrigger('candidatos', 'candidatos_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE', 'DELETE'],
    level: 'ROW',
    function: 'audit_fila',
  });

  // Verificación dura: si el trigger no quedó montado con DELETE, el borrado de
  // candidatos sería invisible en la bitácora y el fallo pasaría desapercibido.
  pgm.sql(`DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
       WHERE t.tgname = 'candidatos_audit_log'
         AND NOT t.tgisinternal
         AND pg_get_triggerdef(t.oid) LIKE '%DELETE%'
    ) THEN
      RAISE EXCEPTION 'El trigger candidatos_audit_log no admite DELETE; la migración 011 está incompleta';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'jefatura'
    ) THEN
      RAISE EXCEPTION 'Falta la columna users.jefatura; la migración 011 está incompleta';
    END IF;
  END $$`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Orden inverso. `audit_fila` vuelve al cuerpo de 004 (copia literal).
  pgm.dropTrigger('candidatos', 'candidatos_audit_log');
  pgm.createTrigger('candidatos', 'candidatos_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'audit_fila',
  });

  pgm.createFunction(
    'audit_fila',
    [],
    { replace: true, returns: 'trigger', language: 'plpgsql' },
    AUDIT_FILA_BODY_004,
  );

  pgm.dropColumn('users', 'jefatura');
}
