import type { Estado, Fase } from '../postulaciones-fases';

/**
 * Forma PÚBLICA de una postulación tal y como sale por la API (camelCase).
 *
 * Es la contraparte de la tabla `postulaciones` (snake_case en BD, migración
 * 007): aquí se fija qué ve el cliente y qué NO.
 *
 * QUÉ NO SE EXPONE: ninguna clave interna extra. `createdBy` SÍ viaja (es la
 * autoría del alta, igual que en `candidatos` y `requerimientos`); los `id` de
 * candidato y requerimiento también, porque son los enlaces que el frontend
 * usa para poblar cada tarjeta del tablero (el módulo no hace JOINs: es una
 * tabla autocontenida). La tabla NO contiene PII: solo dos FK, la fase, el
 * estado y el motivo de descarte.
 */

/**
 * Fila cruda de `postulaciones` tal y como la devuelve `pg`.
 *
 * Se declara como `type` (y no `interface`) a propósito: `pg` exige
 * `T extends QueryResultRow`, es decir, un tipo con firma de índice; los
 * `interface` NO la reciben y los `type` de objeto sí.
 */
export type PostulacionRow = {
  id: string;
  candidato_id: string;
  requerimiento_id: string;
  fase: string;
  estado: string;
  motivo_descarte: string | null;
  created_by: string;
  /** `timestamptz` llega desde `pg` como `Date`. */
  created_at: Date;
  updated_at: Date;
};

export interface PostulacionResponseDto {
  id: string;
  candidatoId: string;
  requerimientoId: string;
  fase: Fase;
  estado: Estado;
  /** `null` mientras no haya descarte (la BD lo garantiza con un CHECK). */
  motivoDescarte: string | null;
  createdBy: string;
  /** ISO 8601 (UTC). */
  createdAt: string;
  updatedAt: string;
}

/** Respuesta paginada de `GET /api/postulaciones`. */
export interface PostulacionesPageDto {
  items: PostulacionResponseDto[];
  /** Total de filas que cumplen el filtro (independiente de la página). */
  total: number;
  page: number;
  limit: number;
}

/**
 * Columnas que SIEMPRE se leen de la tabla (`SELECT` explícito, igual que el
 * módulo `uploads`): el SQL no usa `*`, así que cualquier columna nueva en BD
 * no se cuela en la respuesta hasta que se decida aquí cómo presentarla.
 */
export const COLUMNAS_POSTULACION = `
  id, candidato_id, requerimiento_id, fase, estado, motivo_descarte,
  created_by, created_at, updated_at
`;
