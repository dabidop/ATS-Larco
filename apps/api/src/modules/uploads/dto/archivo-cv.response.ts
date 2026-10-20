/**
 * Forma PÚBLICA de un archivo de CV tal y como sale por la API (camelCase).
 *
 * Es la contraparte de la tabla `archivos_cv` (snake_case en BD, migración
 * 006): aquí se fija qué ve el cliente y qué NO.
 *
 * QUÉ SE EXPONE y por qué:
 *  - `sha256`: es un dato de INTEGRIDAD (hash del contenido, información
 *    pública del propio fichero), no PII: permite al cliente verificar que la
 *    descarga no se corrompió. Nunca se expone la ruta en disco.
 *  - `mimeType`: el derivado por el SERVIDOR a partir de los magic bytes, no el
 *    que declaró el cliente al subir.
 *  - `sizeBytes`: tamaño real en bytes (`bigint` de BD → `number`: el límite de
 *    5 MB está muy por debajo del rango seguro de `Number`).
 *
 * QUÉ NO SE EXPONE: `created_by` (autoría interna, filtrada fuera con
 * `SELECT` explícito) y cualquier referencia al directorio de subidas.
 */

/**
 * Fila cruda de `archivos_cv` tal y como la devuelve `pg`.
 *
 * Se declara como `type` (y no `interface`) a propósito: `pg` exige
 * `T extends QueryResultRow`, es decir, un tipo con firma de índice
 * (`[column: string]: any`); los `interface` NO reciben la firma de índice
 * implícita y los `type` de objeto sí.
 */
export type ArchivoCvRow = {
  id: string;
  candidato_id: string;
  sha256: string;
  filename_original: string;
  mime_type: string;
  /** `bigint` llega desde `pg` como STRING; se convierte en `number` al mapear. */
  size_bytes: string;
  created_at: Date;
};

export interface ArchivoCvResponseDto {
  id: string;
  filenameOriginal: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  candidatoId: string;
  /** ISO 8601 (UTC). */
  createdAt: string;
}

/** Columnas que SÍ se devuelven al cliente (`created_by` queda fuera). */
export const COLUMNAS_PUBLICAS_ARCHIVO = `
  id, candidato_id, sha256, filename_original, mime_type, size_bytes, created_at
`;

/** Mapea una fila `archivos_cv` a su DTO público (snake_case → camelCase). */
export function toResponse(fila: ArchivoCvRow): ArchivoCvResponseDto {
  return {
    id: fila.id,
    filenameOriginal: fila.filename_original,
    mimeType: fila.mime_type,
    sizeBytes: Number(fila.size_bytes),
    sha256: fila.sha256,
    candidatoId: fila.candidato_id,
    createdAt: fila.created_at.toISOString(),
  };
}
