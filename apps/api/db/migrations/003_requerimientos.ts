import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 003 — Módulo de Requerimientos de personal (Fase 3, parte 1).
 *
 * Contenido:
 *  1. ENUM `estado_requerimiento`: pendiente → aprobado → en_proceso →
 *     cerrado | rechazado (máquina de estados del plan).
 *  2. Tabla `requerimientos` con las 5 secciones del formulario.
 *  3. `codigo_sequences`: contador anual que soportará el generador atómico
 *     `REQ-YYYY-NNN` (SOLO la tabla vive aquí; el generador llega en la parte 2).
 *  4. Auditoría desde BD con la función genérica `audit_fila()`.
 *
 * Regla dura del proyecto ("la base de datos manda"): los invariantes son
 * CHECK en PostgreSQL, no lógica de aplicación:
 *  - `code ~ '^REQ-[0-9]{4}-[0-9]{3,}$'` (REQ-YYYY-NNN).
 *  - `numero_plazas >= 1`.
 *  - `salario_min >= 0`, `salario_max >= 0` y `salario_min <= salario_max`.
 *  - `estado <> 'rechazado' OR motivo_rechazo IS NOT NULL` (rechazar exige
 *    motivo; la propia BD lo garantiza).
 *
 * Nota sobre la auditoría: la migración 001 creó `users_audit_log()`, una
 * función ESPECÍFICA de `users` (nombre de tabla e `id` codificados a mano),
 * así que no es reutilizable tal cual. Aquí se crea `audit_fila()`, genérica
 * (`TG_TABLE_NAME` + `id` de la fila + `created_by` si la tabla lo tiene), y se
 * aplica a LAS DOS tablas auditadas: `users` y `requerimientos`. El fichero 001
 * NO se modifica (ya está aplicado en todas las bases de datos); el `down` de
 * esta migración restaura exactamente la función y el trigger originales de
 * 001 sobre `users`. El resultado observable es idéntico al anterior: una fila
 * de `audit_log` por cada INSERT/UPDATE.
 *
 * Nota: `gen_random_uuid()` es nativo del núcleo de PostgreSQL >= 13 (el
 * proyecto corre sobre PostgreSQL 16), no hace falta `pgcrypto`.
 */

/** Orden EXACTO del ENUM en BD: el orden del tipo es observable. */
const ESTADOS: string[] = ['pendiente', 'aprobado', 'en_proceso', 'cerrado', 'rechazado'];

/**
 * Cuerpo de `audit_fila()`: INSERT/UPDATE → `audit_log` con `to_jsonb(OLD/NEW)`.
 *
 * `changed_by`: manda `NEW.created_by` (requerimientos); si la tabla no tiene
 * esa columna (users) o viene vacía, se cae al GUC de sesión
 * `app.current_user_id` —el patrón de 001— y, en su defecto, NULL.
 *
 * `record_id` es `NEW.id` en texto (ambas tablas usan uuid como PK).
 */
const AUDIT_FILA_BODY = `DECLARE
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

/**
 * Copia EXACTA del cuerpo de `users_audit_log()` definido en 001.
 * Solo se usa en el `down` de esta migración, para devolver `users` al estado
 * previo sin editar el fichero 001 (ya aplicado).
 */
const USERS_AUDIT_LOG_001_BODY = `BEGIN
  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    'users',
    NEW.id::text,
    TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    to_jsonb(NEW),
    NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );
  RETURN NEW;
END;`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1) ENUM de estados
  // ---------------------------------------------------------------------------
  pgm.createType('estado_requerimiento', ESTADOS);

  // ---------------------------------------------------------------------------
  // 2) Tabla requerimientos (las 5 secciones del formulario, en orden)
  //
  // `numeric(12,2)` se declara en el propio tipo: node-pg-migrate ignora las
  // claves `precision`/`scale` al generar la columna.
  // ---------------------------------------------------------------------------
  pgm.createTable('requerimientos', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code: { type: 'text', notNull: true, unique: true },
    estado: { type: 'estado_requerimiento', notNull: true, default: 'pendiente' },
    created_by: { type: 'uuid', notNull: true, references: 'users(id)' },
    // Sección 1 — identificación y jefatura
    titulo: { type: 'text', notNull: true },
    jefatura: { type: 'text', notNull: true },
    numero_plazas: { type: 'int', notNull: true },
    ubicacion: { type: 'text' },
    fecha_requerida: { type: 'date' },
    // Sección 2 — perfil profesional
    experiencia_requerida: { type: 'text' },
    nivel_educacion: { type: 'text' },
    perfil_profesional: { type: 'text', notNull: true },
    // Sección 3 — conocimientos y habilidades (arrays de texto)
    conocimientos: { type: 'text[]', notNull: true, default: '{}' },
    habilidades: { type: 'text[]', notNull: true, default: '{}' },
    // Sección 4 — condiciones salariales y contractuales
    salario_min: { type: 'numeric(12,2)' },
    salario_max: { type: 'numeric(12,2)' },
    tipo_contrato: { type: 'text' },
    jornada: { type: 'text' },
    // Sección 5 — justificación
    justificacion: { type: 'text', notNull: true },
    motivo_rechazo: { type: 'text' },
    // Control temporal (updated_at lo mantiene el trigger set_updated_at)
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // ---------------------------------------------------------------------------
  // 3) Constraints a nivel tabla ("la base de datos manda")
  // ---------------------------------------------------------------------------
  pgm.addConstraint('requerimientos', 'requerimientos_code_check', {
    check: "code ~ '^REQ-[0-9]{4}-[0-9]{3,}$'",
  });

  pgm.addConstraint('requerimientos', 'requerimientos_numero_plazas_check', {
    check: 'numero_plazas >= 1',
  });

  pgm.addConstraint('requerimientos', 'requerimientos_salario_min_check', {
    check: 'salario_min >= 0',
  });

  pgm.addConstraint('requerimientos', 'requerimientos_salario_max_check', {
    check: 'salario_max >= 0',
  });

  pgm.addConstraint('requerimientos', 'requerimientos_salario_rango_check', {
    check: 'salario_min IS NULL OR salario_max IS NULL OR salario_min <= salario_max',
  });

  // Rechazar exige motivo: lo garantiza la BD, no la aplicación.
  pgm.addConstraint('requerimientos', 'requerimientos_rechazo_check', {
    check: "estado <> 'rechazado' OR motivo_rechazo IS NOT NULL",
  });

  // ---------------------------------------------------------------------------
  // 4) Índices de lectura
  // ---------------------------------------------------------------------------
  pgm.createIndex('requerimientos', 'estado');
  pgm.createIndex('requerimientos', 'jefatura');
  pgm.createIndex('requerimientos', 'created_at');

  // ---------------------------------------------------------------------------
  // 5) Contador anual de códigos (REQ-YYYY-NNN): SOLO la tabla aquí.
  //    El generador atómico (SELECT ... FOR UPDATE / upsert) llega en la parte 2.
  // ---------------------------------------------------------------------------
  pgm.createTable('codigo_sequences', {
    anio: { type: 'int', primaryKey: true },
    ultimo: { type: 'int', notNull: true, default: 0 },
  });

  // ---------------------------------------------------------------------------
  // 6) Triggers: updated_at + auditoría
  // ---------------------------------------------------------------------------
  pgm.createFunction(
    'audit_fila',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    AUDIT_FILA_BODY,
  );

  // updated_at reutiliza la función genérica creada en 001.
  pgm.createTrigger('requerimientos', 'requerimientos_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });

  pgm.createTrigger('requerimientos', 'requerimientos_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'audit_fila',
  });

  // `users` migra a la función genérica: se sustituye el trigger de 001 por
  // otro con el MISMO nombre apuntando a `audit_fila()` (mismo resultado
  // observable). 001 no se toca; el `down` restaura función + trigger.
  pgm.dropTrigger('users', 'users_audit_log');
  pgm.dropFunction('users_audit_log', [], { ifExists: true });
  pgm.createTrigger('users', 'users_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'audit_fila',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Triggers primero: dependen de funciones y de la tabla `requerimientos`.
  pgm.dropTrigger('requerimientos', 'requerimientos_audit_log');
  pgm.dropTrigger('requerimientos', 'requerimientos_set_updated_at');
  pgm.dropTrigger('users', 'users_audit_log');

  // Tablas y tipo en orden inverso de dependencias (tipo al final).
  pgm.dropTable('requerimientos');
  pgm.dropTable('codigo_sequences');
  pgm.dropType('estado_requerimiento');

  // `set_updated_at` NO se toca: pertenece a la migración 001.
  pgm.dropFunction('audit_fila', [], { ifExists: true });

  // Restaurar el estado EXACTO de 001 sobre `users` (función + trigger).
  pgm.createFunction(
    'users_audit_log',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    USERS_AUDIT_LOG_001_BODY,
  );
  pgm.createTrigger('users', 'users_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'users_audit_log',
  });
}
