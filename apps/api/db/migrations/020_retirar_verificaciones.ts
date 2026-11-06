import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 020 — RETIRO DE VERIFICACIONES DEL ATS.
 *
 * Las decisiones funcionales establecen que antecedentes y proveedor externo
 * se gestionan fuera del ATS y que sus resultados no se almacenan. Las
 * migraciones 017–019 se conservan como historial; esta migración retira sus
 * tablas, tipos, índices y funciones del esquema operativo.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('verificacion_eventos', { ifExists: true });
  pgm.dropTable('verificaciones', { ifExists: true });
  pgm.dropFunction('verificacion_eventos_ensure_immutable', [], { ifExists: true });
  pgm.dropType('resultado_verificacion', { ifExists: true });
  pgm.dropType('estado_verificacion', { ifExists: true });
  pgm.dropType('tipo_verificacion', { ifExists: true });
}

export async function down(): Promise<void> {
  throw new Error(
    '020_retirar_verificaciones no es reversible automáticamente: el modelo fue retirado por decisión de negocio',
  );
}
