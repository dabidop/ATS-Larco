/**
 * Forma PÚBLICA de una entrevista (Etapa 9, módulo «Entrevistas» de la
 * muestra). Incluye el candidato y el requerimiento resueltos en el servidor
 * (la agenda necesita «Juan Pérez — REQ-2026-001» sin dos llamadas extra).
 */
export interface EntrevistaResponseDto {
  id: string;
  postulacionId: string;
  /** Fecha calendario `YYYY-MM-DD`. */
  fecha: string;
  /** Hora `HH:MM`, o `null` si la entrevista solo tiene día. */
  hora: string | null;
  tipo: string;
  entrevistador: string | null;
  estado: string;
  notas: string | null;
  candidato: { id: string; nombre: string };
  requerimiento: { id: string; codigo: string; titulo: string };
  creadoEn: string;
  actualizadoEn: string;
}

/** Fila cruda del JOIN entrevistas → postulaciones → candidatos/requerimientos. */
export interface EntrevistaFilaCruda {
  id: string;
  postulacion_id: string;
  /** `to_char(fecha, 'YYYY-MM-DD')` en SQL: sin deriva de zona horaria. */
  fecha: string;
  /** `to_char(hora, 'HH24:MI')` en SQL, o `null`. */
  hora: string | null;
  tipo: string;
  entrevistador: string | null;
  estado: string;
  notas: string | null;
  candidato_id: string;
  candidato_nombre: string;
  candidato_apellidos: string;
  requerimiento_id: string;
  requerimiento_codigo: string;
  requerimiento_titulo: string;
  created_at: Date;
  updated_at: Date;
}

/** Columnas del SELECT del listado (compartidas por lista, crear y detalle). */
export const COLUMNAS_ENTREVISTA = `
  e.id, e.postulacion_id,
  to_char(e.fecha, 'YYYY-MM-DD') AS fecha,
  CASE WHEN e.hora IS NULL THEN NULL ELSE to_char(e.hora, 'HH24:MI') END AS hora,
  e.tipo, e.entrevistador, e.estado, e.notas,
  c.id AS candidato_id, c.nombres AS candidato_nombre, c.apellidos AS candidato_apellidos,
  r.id AS requerimiento_id, r.code AS requerimiento_codigo, r.titulo AS requerimiento_titulo,
  e.created_at, e.updated_at`;

/** FROM+JOIN del listado (compartido por lista y detalle). */
export const FROM_ENTREVISTA = `
  FROM entrevistas e
  JOIN postulaciones p ON p.id = e.postulacion_id
  JOIN candidatos c ON c.id = p.candidato_id
  JOIN requerimientos r ON r.id = p.requerimiento_id`;

/** Fila cruda → respuesta (nombres en camelCase, fechas ISO). */
export function toResponse(fila: EntrevistaFilaCruda): EntrevistaResponseDto {
  return {
    id: fila.id,
    postulacionId: fila.postulacion_id,
    fecha: fila.fecha,
    hora: fila.hora,
    tipo: fila.tipo,
    entrevistador: fila.entrevistador,
    estado: fila.estado,
    notas: fila.notas,
    candidato: {
      id: fila.candidato_id,
      nombre: `${fila.candidato_nombre} ${fila.candidato_apellidos}`.trim(),
    },
    requerimiento: {
      id: fila.requerimiento_id,
      codigo: fila.requerimiento_codigo,
      titulo: fila.requerimiento_titulo,
    },
    creadoEn: fila.created_at.toISOString(),
    actualizadoEn: fila.updated_at.toISOString(),
  };
}
