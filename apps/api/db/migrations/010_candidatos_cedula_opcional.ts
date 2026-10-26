import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 010 — Etapa 9C: cédula OPCIONAL en `candidatos` (ingesta masiva de HVs).
 *
 * Contexto: la importación masiva de hojas de vida (regla de la muestra, módulo
 * «Importar HVs») crea candidatos desde PDFs y la cédula NO existe en el CV.
 * Hasta ahora `cedula_cifrada` y `cedula_hash` eran NOT NULL, imposibilitando
 * el alta masiva; este relajamiento deja la cédula como dato COMPLETABLE por
 * el analista desde la ficha del candidato (`PATCH /api/candidatos/:id`
 * re-cifra y re-hashea).
 *
 * Cambios:
 *  1. `cedula_cifrada` y `cedula_hash` pasan a NULLABLE.
 *  2. Los CHECK de formato admiten NULL:
 *     `cedula_cifrada IS NULL OR cedula_cifrada LIKE 'v1:%'` y
 *     `cedula_hash IS NULL OR cedula_hash ~ '^[0-9a-f]{64}$'`.
 *  3. El índice único de la cédula pasa a PARCIAL (`WHERE cedula_hash IS NOT
 *     NULL`): siguen prohibidas las cédulas duplicadas, y los candidatos sin
 *     cédula no colisionan entre sí (todos NULL). El NOMBRE del índice se
 *     mantiene (`candidatos_cedula_hash_unique`) para no romper la traducción
 *     23505 → 409 del servicio de candidatos.
 *
 * Fuera de alcance (a propósito): el email YA era parcial (`WHERE email IS NOT
 * NULL`), así que la importación puede crear candidatos sin correo.
 *
 * down(): restaura NOT NULL y los CHECK/índice originales; FALLA si existen
 * candidatos importados aún sin cédula (documentado: completes o borras esos
 * candidatos antes de revertir).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  // 1) Se relajan los NOT NULL.
  pgm.sql(`ALTER TABLE candidatos
    ALTER COLUMN cedula_cifrada DROP NOT NULL,
    ALTER COLUMN cedula_hash DROP NOT NULL`);

  // 2) Los CHECK admiten NULL (mismo patrón que telefono_cifrada, ya nullable).
  pgm.dropConstraint('candidatos', 'candidatos_cedula_cifrada_check');
  pgm.addConstraint('candidatos', 'candidatos_cedula_cifrada_check', {
    check: `cedula_cifrada IS NULL OR cedula_cifrada LIKE 'v1:%'`,
  });

  pgm.dropConstraint('candidatos', 'candidatos_cedula_hash_check');
  pgm.addConstraint('candidatos', 'candidatos_cedula_hash_check', {
    check: `cedula_hash IS NULL OR cedula_hash ~ '^[0-9a-f]{64}$'`,
  });

  // 3) Índice único PARCIAL con el MISMO nombre (la capa de servicio mapea el
  //    23505 por nombre de constraint). `DROP INDEX` explícito: el índice tiene
  //    nombre personalizado y `pgm.dropIndex('candidatos','cedula_hash')`
  //    generaría `candidatos_cedula_hash` (inexistente).
  pgm.sql(`DROP INDEX IF EXISTS candidatos_cedula_hash_unique`);
  pgm.sql(`CREATE UNIQUE INDEX candidatos_cedula_hash_unique
    ON candidatos (cedula_hash) WHERE cedula_hash IS NOT NULL`);

  // Verificación dura: el índice debe existir y ser PARCIAL; si no, la
  // migración queda incompleta y revienta aquí en vez de seguir a medias.
  pgm.sql(`DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE tablename = 'candidatos'
         AND indexname = 'candidatos_cedula_hash_unique'
         AND indexdef LIKE '%WHERE%cedula_hash IS NOT NULL%'
    ) THEN
      RAISE EXCEPTION 'El índice candidatos_cedula_hash_unique no quedó PARCIAL; la migración 010 está incompleta';
    END IF;
  END $$`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Orden inverso. NOTA: `SET NOT NULL` revienta si algún candidato importado
  // sigue sin cédula; completa o borra esos candidatos antes de revertir.
  pgm.sql(`DROP INDEX IF EXISTS candidatos_cedula_hash_unique`);
  pgm.sql(`CREATE UNIQUE INDEX candidatos_cedula_hash_unique
    ON candidatos (cedula_hash)`);

  pgm.dropConstraint('candidatos', 'candidatos_cedula_cifrada_check');
  pgm.addConstraint('candidatos', 'candidatos_cedula_cifrada_check', {
    check: "cedula_cifrada LIKE 'v1:%'",
  });

  pgm.dropConstraint('candidatos', 'candidatos_cedula_hash_check');
  pgm.addConstraint('candidatos', 'candidatos_cedula_hash_check', {
    check: "cedula_hash ~ '^[0-9a-f]{64}$'",
  });

  pgm.sql(`ALTER TABLE candidatos
    ALTER COLUMN cedula_cifrada SET NOT NULL,
    ALTER COLUMN cedula_hash SET NOT NULL`);
}
