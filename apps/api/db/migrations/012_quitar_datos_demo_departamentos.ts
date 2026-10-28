import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 012 — elimina coordinadores de demostración sembrados en la muestra.
 *
 * No toca coordinadores que ya hayan sido reemplazados por Gestión Humana:
 * únicamente normaliza los ocho nombres exactos de la maqueta a un estado
 * explícito de configuración pendiente.
 */
const NOMBRES_DEMO = [
  'Juan Munera',
  'Mary Luz Ortega Jaramillo',
  'Bibiana Betancur Morales',
  'Ana María García',
  'Estefania Tascon Monsalve',
  'Natalia Arango',
  'Carolina García Calle',
  'Mauricio Rivera',
];

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(
    `UPDATE departamentos
        SET coordinador = 'Por asignar'
      WHERE coordinador IN (${NOMBRES_DEMO.map((nombre) => `'${nombre.replace(/'/g, "''")}'`).join(', ')})`,
  );
}

export async function down(): Promise<void> {
  // No se restauran datos personales de demostración en un rollback.
}
