import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 022 — Alinea la FK de candidatos con 021.
 * 009 usaba SET NULL, incompatible con departamento_id NOT NULL.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE candidatos
      DROP CONSTRAINT IF EXISTS candidatos_departamento_id_fkey,
      ADD CONSTRAINT candidatos_departamento_id_fkey
        FOREIGN KEY (departamento_id) REFERENCES departamentos(id) ON DELETE RESTRICT
  `);
}

/**
 * Revierte la acción solo si 021 ya dejó de aplicar. El runner normal no
 * permite bajar 021 mientras 022 sea la última migración; por eso una
 * reversión ordenada requiere retirar primero 021 en un entorno controlado.
 * Mientras departamento_id siga NOT NULL, fallar es preferible a desmarcar
 * 022 dejando RESTRICT y una historia de migraciones falsa.
 */
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DO $migration$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema()
           AND c.relname = 'candidatos'
           AND a.attname = 'departamento_id'
           AND a.attnotnull
      ) THEN
        RAISE EXCEPTION
          'No se puede revertir 022 mientras 021 mantenga candidatos.departamento_id como NOT NULL'
          USING ERRCODE = '55006';
      END IF;
    END
    $migration$;

    ALTER TABLE candidatos
      DROP CONSTRAINT IF EXISTS candidatos_departamento_id_fkey,
      ADD CONSTRAINT candidatos_departamento_id_fkey
        FOREIGN KEY (departamento_id) REFERENCES departamentos(id) ON DELETE SET NULL
  `);
}
