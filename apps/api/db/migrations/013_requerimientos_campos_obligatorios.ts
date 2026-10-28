import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 013 — todos los campos funcionales del requerimiento son obligatorios para
 * nuevas escrituras. Las restricciones se crean NOT VALID para no inventar
 * información en los registros históricos incompletos del piloto; el comando
 * falla al intentar validar hasta que esos datos hayan sido completados.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE requerimientos
      ADD CONSTRAINT requerimientos_campos_obligatorios_check CHECK (
        departamento_id IS NOT NULL AND btrim(ubicacion) <> '' AND fecha_requerida IS NOT NULL
        AND btrim(experiencia_requerida) <> '' AND btrim(nivel_educacion) <> ''
        AND salario_min IS NOT NULL AND salario_max IS NOT NULL
        AND btrim(tipo_contrato) <> '' AND btrim(jornada) <> ''
        AND cardinality(conocimientos) > 0 AND cardinality(habilidades) > 0
        AND array_position(conocimientos, '') IS NULL
        AND array_position(habilidades, '') IS NULL
      ) NOT VALID
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('requerimientos', 'requerimientos_campos_obligatorios_check');
}
