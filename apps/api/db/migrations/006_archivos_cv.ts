import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 006 — Archivos de CV adjuntos a un candidato (Fase 4, parte 2).
 *
 * Contenido:
 *  1. Tabla `archivos_cv`: una fila POR SUBIDA de un archivo a un candidato.
 *     El contenido NO se guarda en la fila: vive en disco con nombre
 *     `<UPLOAD_DIR>/<sha256>` (ver `AlmacenamientoService`).
 *  2. Constraints "la base de datos manda": hash en hex, tamaño positivo y el
 *     par `(candidato_id, sha256)` ÚNICO (dedup POR CANDIDATO).
 *  3. Índices de lectura (`candidato_id`) y de unicidad.
 *  4. Trigger de auditoría `audit_fila()` (genérica desde la migración 004, con
 *     el GUC `app.current_user_id`).
 *
 * DECISIONES DE DISEÑO (documentadas):
 *
 * - `sha256` es el NOMBRE del fichero en disco (hex minúsculas, 64 chars) y por
 *   eso lleva el CHECK de formato: la BD rechaza cualquier hash que no pueda
 *   ser un nombre de fichero seguro. Nunca se expone una ruta al cliente; el
 *   hash SÍ se devuelve como dato de integridad.
 *
 * - `UNIQUE (candidato_id, sha256)` y NO global a propósito. Dos lecturas:
 *    (a) MISMO candidato + MISMO contenido → 409 ("ya está adjunto"): no tiene
 *        sentido adjuntar dos veces el mismo bytes.
 *    (b) DISTINTOS candidatos + MISMO contenido → dos filas PERO UN SOLO fichero
 *        en disco (dedup de ALMACENAMIENTO, no de metadatos). Varias personas
 *        pueden adjuntar la misma plantilla de CV y el disco solo paga una vez;
 *        además cada fila conserva su `filename_original`, `mime_type` y
 *        `created_by` propios, que sí son distintos.
 *
 * - `candidato_id` con `ON DELETE CASCADE`: hoy NO existe
 *   `DELETE /api/candidatos/:id` (trazabilidad; ver `CandidatosController`), pero
 *   la FK queda bien definida para cuando llegue el borrado lógico/físico: al
 *   borrar el candidato, sus metadatos de archivo siguen al candidato en una
 *   única operación atómica. Los ficheros EN DISCO no se borran (retención:
 *   ver `AlmacenamientoService`).
 *
 * - `filename_original` y `mime_type` se guardan SIEMPRE derivados de lo que
 *   el servidor verificó (magic bytes), jamás de lo que declare el cliente:
 *   `mime_type` es por tanto `application/pdf`, `application/msword`,
 *   `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
 *   o `application/rtf`.
 *
 * - Auditoría SOLO en `INSERT`/`UPDATE` (mismo alcance que `candidatos`). El
 *   `DELETE` en cascada NO audita: `audit_fila()` construye la fila nueva con
 *   `to_jsonb(NEW)`, que es `NULL` en un borrado, y `audit_log.record_id` es
 *   `NOT NULL`; además el borrado en cascada no aporta información de negocio
 *   nueva (la trazabilidad relevante es el ALTA del archivo).
 *
 * Nota: `gen_random_uuid()` es nativo del núcleo de PostgreSQL >= 13 (el
 * proyecto corre sobre PostgreSQL 16), no hace falta `pgcrypto`.
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1) Tabla archivos_cv
  // ---------------------------------------------------------------------------
  pgm.createTable('archivos_cv', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    // Aunque hoy no exista DELETE de candidatos, la FK queda bien definida.
    candidato_id: {
      type: 'uuid',
      notNull: true,
      references: 'candidatos(id)',
      onDelete: 'CASCADE',
    },
    // SHA-256 en hex minúsculas: es además el nombre del fichero en disco.
    sha256: { type: 'text', notNull: true },
    filename_original: { type: 'text', notNull: true },
    // SIEMPRE el tipo derivado de los magic bytes (nunca el declarado por el cliente).
    mime_type: { type: 'text', notNull: true },
    // `bigint` se recibe desde `pg` como string; el mapeo a number lo hace la app.
    size_bytes: { type: 'bigint', notNull: true },
    created_by: { type: 'uuid', notNull: true, references: 'users(id)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // ---------------------------------------------------------------------------
  // 2) Constraints a nivel tabla
  // ---------------------------------------------------------------------------

  // El hash es SHA-256 en hex: exactamente 64 dígitos hex en minúscula.
  // Bloquea en BD cualquier `sha256` que no sea un nombre de fichero seguro.
  pgm.addConstraint('archivos_cv', 'archivos_cv_sha256_check', {
    check: "sha256 ~ '^[0-9a-f]{64}$'",
  });

  // Un archivo vacío no tiene sentido: refuerza la comprobación de servidor.
  pgm.addConstraint('archivos_cv', 'archivos_cv_size_bytes_check', {
    check: 'size_bytes > 0',
  });

  // Nombre EXPLÍCITO: la capa de servicio traduce el error de BD 23505
  // (unique_violation) a un 409 "El archivo ya está adjunto a este candidato".
  pgm.addConstraint('archivos_cv', 'archivos_cv_candidato_sha256_unique', {
    unique: ['candidato_id', 'sha256'],
  });

  // ---------------------------------------------------------------------------
  // 3) Índices de lectura
  // ---------------------------------------------------------------------------

  // Listado de los archivos de UN candidato (`GET /:id/archivos`).
  pgm.createIndex('archivos_cv', 'candidato_id');
  // Listado por defecto ordenado por created_at DESC.
  pgm.createIndex('archivos_cv', 'created_at');

  // ---------------------------------------------------------------------------
  // 4) Trigger de auditoría (reutiliza `audit_fila`, en su versión 004)
  // ---------------------------------------------------------------------------

  // `audit_fila` prioriza el GUC `app.current_user_id` y, en su ausencia, cae a
  // `NEW.created_by`: `ArchivosCvService` fija el GUC con el `sub` del JWT dentro
  // de la transacción de escritura, igual que el resto de módulos.
  pgm.createTrigger('archivos_cv', 'archivos_cv_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'audit_fila',
  });

  // Verificación dura: si el trigger no quedó montado, la migración falla
  // ruidosamente en lugar de seguir sin historial.
  pgm.sql(`
DO $migrate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'archivos_cv_audit_log' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'El trigger archivos_cv_audit_log no pudo crearse; la migración 006 está incompleta';
  END IF;
END
$migrate$
`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Trigger antes que la tabla (depende de `audit_fila`, creada en 003/004).
  pgm.dropTrigger('archivos_cv', 'archivos_cv_audit_log');

  // `dropTable` elimina también los índices y constraints creados arriba,
  // incluida la FK a `candidatos` con ON DELETE CASCADE.
  pgm.dropTable('archivos_cv');

  // `audit_fila` (003/004) NO se toca: la sigue usando `candidatos`, `users` y
  // `requerimientos`. El `down` es reversible sin romper 001-005. Los ficheros
  // en disco no se tocan (retención).
}
