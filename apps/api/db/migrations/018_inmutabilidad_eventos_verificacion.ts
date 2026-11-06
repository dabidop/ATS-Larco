import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 018 — INMUTABILIDAD DE EVENTOS DE VERIFICACIÓN.
 *
 * Los eventos son la traza de la cola y deben ser append-only. La migración
 * 017 garantizaba esa regla por convención de escritura, pero no impedía una
 * mutación SQL directa. Este trigger cierra esa brecha sin modificar eventos
 * existentes ni depender de la API.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
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

  pgm.createTrigger('verificacion_eventos', 'verificacion_eventos_no_mutation', {
    when: 'BEFORE',
    operation: ['UPDATE', 'DELETE'],
    level: 'ROW',
    function: 'verificacion_eventos_ensure_immutable',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTrigger('verificacion_eventos', 'verificacion_eventos_no_mutation');
  pgm.dropFunction('verificacion_eventos_ensure_immutable', []);
}
