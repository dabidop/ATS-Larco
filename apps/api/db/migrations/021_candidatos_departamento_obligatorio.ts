import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 021 — Todo candidato debe pertenecer a un área.
 *
 * Recupera el área cuando existe una postulación cuyo requerimiento ya tiene
 * departamento. Los casos restantes no se asignan arbitrariamente: la
 * migración se detiene para que RRHH los clasifique.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    UPDATE candidatos c
       SET departamento_id = r.departamento_id
      FROM postulaciones p
      JOIN requerimientos r ON r.id = p.requerimiento_id
     WHERE p.candidato_id = c.id
       AND c.departamento_id IS NULL
       AND r.departamento_id IS NOT NULL
  `);

  pgm.sql(`
    DO $migration$
    BEGIN
      IF EXISTS (SELECT 1 FROM candidatos WHERE departamento_id IS NULL) THEN
        RAISE EXCEPTION
          'No se puede hacer obligatorio candidatos.departamento_id: existen candidatos sin área; asígnelos manualmente antes de aplicar la migración 021';
      END IF;
    END
    $migration$
  `);
  pgm.alterColumn('candidatos', 'departamento_id', { notNull: true });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.alterColumn('candidatos', 'departamento_id', { notNull: false });
}
