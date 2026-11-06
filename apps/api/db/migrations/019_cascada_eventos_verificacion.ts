import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 019 — CASCADA CONTROLADA DE EVENTOS DE VERIFICACIÓN.
 *
 * 018 protegió los eventos contra DELETE directo, pero también interceptaba el
 * ON DELETE CASCADE legítimo de una postulación. Durante esa cascada la fila de
 * `verificaciones` ya no existe; ese es el único DELETE que se permite aquí.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION verificacion_eventos_ensure_immutable()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF TG_OP = 'DELETE'
         AND NOT EXISTS (
           SELECT 1 FROM verificaciones WHERE id = OLD.verificacion_id
         ) THEN
        RETURN OLD;
      END IF;

      RAISE EXCEPTION 'verificacion_eventos es append-only: % no está permitido', TG_OP;
    END
    $fn$;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION verificacion_eventos_ensure_immutable()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      RAISE EXCEPTION 'verificacion_eventos es append-only: % no está permitido', TG_OP;
    END
    $fn$;
  `);
}
