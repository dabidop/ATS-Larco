import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 001 — Esquema inicial (roles, users, audit_log).
 *
 * Reglas duras del proyecto ("la base de datos manda"):
 *  - `audit_log` es INMUTABLE: los triggers `BEFORE UPDATE` / `BEFORE DELETE`
 *    lanzan una excepción. Los registros de auditoría solo se INSERTAN.
 *  - La auditoría se escribe desde triggers en BD (nunca desde la aplicación).
 *  - Toda tabla con datos mutables mantiene `updated_at` vía `set_updated_at()`.
 *
 * Nota: `gen_random_uuid()` es nativo del núcleo de PostgreSQL >= 13, no hace
 * falta la extensión `pgcrypto` (el proyecto corre sobre PostgreSQL 16).
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ---------------------------------------------------------------------------
  // Tablas
  // ---------------------------------------------------------------------------
  pgm.createTable('roles', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    code: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    role_id: { type: 'uuid', notNull: true, references: 'roles(id)' },
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    full_name: { type: 'text', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  pgm.createTable('audit_log', {
    id: { type: 'bigserial', primaryKey: true },
    table_name: { type: 'text', notNull: true },
    record_id: { type: 'text', notNull: true },
    action: { type: 'text', notNull: true },
    old_data: { type: 'jsonb' },
    new_data: { type: 'jsonb' },
    changed_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  pgm.addConstraint('audit_log', 'audit_log_action_check', {
    check: "action IN ('INSERT','UPDATE','DELETE')",
  });

  // ---------------------------------------------------------------------------
  // Índices
  // ---------------------------------------------------------------------------
  pgm.createIndex('users', 'role_id');
  pgm.createIndex('audit_log', ['table_name', 'record_id']);
  pgm.createIndex('audit_log', 'created_at');

  // ---------------------------------------------------------------------------
  // Funciones y triggers
  // ---------------------------------------------------------------------------
  pgm.createFunction(
    'set_updated_at',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;`,
  );

  pgm.createTrigger('users', 'users_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });

  // Inmutabilidad de audit_log: cualquier UPDATE/DELETE sobre la tabla falla.
  pgm.createFunction(
    'audit_log_ensure_immutable',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
  RAISE EXCEPTION 'audit_log es una tabla inmutable: % no está permitido', TG_OP
    USING HINT = 'Los registros de auditoría solo se crean mediante INSERT (desde triggers).';
END;`,
  );

  pgm.createTrigger('audit_log', 'audit_log_no_mutation', {
    when: 'BEFORE',
    operation: ['UPDATE', 'DELETE'],
    level: 'ROW',
    function: 'audit_log_ensure_immutable',
  });

  // Auditoría de ejemplo sobre `users` (INSERT/UPDATE) con old/new completos.
  // `changed_by` toma el usuario de la sesión si la app fija el GUC
  // `app.current_user_id` (p. ej. `SET app.current_user_id = '<uuid>'`); si no,
  // queda en NULL.
  pgm.createFunction(
    'users_audit_log',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
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
END;`,
  );

  pgm.createTrigger('users', 'users_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'users_audit_log',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Triggers antes que funciones, y tablas en orden inverso de dependencias.
  pgm.dropTrigger('users', 'users_audit_log');
  pgm.dropTrigger('audit_log', 'audit_log_no_mutation');
  pgm.dropTrigger('users', 'users_set_updated_at');

  pgm.dropFunction('users_audit_log', [], { ifExists: true });
  pgm.dropFunction('audit_log_ensure_immutable', [], { ifExists: true });
  pgm.dropFunction('set_updated_at', [], { ifExists: true });

  pgm.dropTable('audit_log');
  pgm.dropTable('users');
  pgm.dropTable('roles');
}
