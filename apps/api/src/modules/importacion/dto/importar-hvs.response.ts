/** Desenlace de UN archivo del lote importado. */
export interface ResultadoArchivoDto {
  /** Nombre original del archivo (como lo eligió quien lo subió). */
  archivo: string;
  ok: boolean;
  /** Id del candidato creado (presente aunque el adjunto del CV falle). */
  candidatoId?: string;
  /** Motivo del fallo en español (solo cuando `ok` es falso). */
  motivo?: string;
}

/**
 * Respuesta de `POST /api/importacion/hvs` (Etapa 9): un resumen del lote con
 * UN resultado por archivo. La importación es POR ARCHIVO (no transaccional en
 * todo el lote): un HV malformado no cancela los demás; cada fila dice qué
 * pasó con su archivo.
 */
export interface ImportarHvsResponseDto {
  /** Archivos recibidos en el multipart. */
  procesados: number;
  /** Candidatos creados con su CV adjunto. */
  creados: number;
  /** Archivos que no produjeron candidato (motivo por archivo). */
  fallidos: number;
  resultados: ResultadoArchivoDto[];
}
