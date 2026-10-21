import type { Estado, Fase } from '../postulaciones-fases';

/**
 * Forma PÚBLICA de una postulación tal y como sale por la API (camelCase).
 *
 * Es la contraparte de la tabla `postulaciones` (snake_case en BD, migración
 * 007): aquí se fija qué ve el cliente y qué NO.
 *
 * QUÉ NO SE EXPONE: ninguna clave interna extra. `createdBy` SÍ viaja (es la
 * autoría del alta, igual que en `candidatos` y `requerimientos`). La tabla
 * NO contiene PII: solo dos FK, la fase, el estado y el motivo de descarte.
 *
 * DEL CANDIDATO solo va un RESUMEN `{ id, nombres, apellidos }` (las
 * lecturas hacen JOIN con `candidatos`): es lo que el tablero Kanban pinta
 * en cada tarjeta, y sin él el frontend tendría que hacer N+1 GETs. Ni
 * cédula, ni email, ni teléfono: el tablero no los necesita.
 */

/**
 * Fila cruda de `postulaciones` tal y como la devuelve `pg` en los RETURNING
 * de INSERT/UPDATE (que NO pueden hacer JOIN: solo ven la tabla escrita).
 *
 * Se declara como `type` (y no `interface`) a propósito: `pg` exige
 * `T extends QueryResultRow`, es decir, un tipo con firma de índice; los
 * `interface` NO la reciben y los `type` de objeto sí.
 */
export type PostulacionFilaCruda = {
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

/**
 * Fila de LECTURA (SELECT con JOIN a `candidatos`): la cruda más el resumen
 * del candidato que las tarjetas del tablero necesitan pintar (DECISIÓN de
 * integración con el frontend: sin el nombre, el Kanban haría N+1 GETs).
 *
 * SOLO nombre y apellidos: ni cédula, ni email, ni teléfono (PII que el
 * tablero no necesita aunque el JOIN la traería).
 */
export type PostulacionRow = PostulacionFilaCruda & {
  nombres_candidato: string;
  apellidos_candidato: string;
};

/** Resumen PÚBLICO del candidato de una postulación (SIN PII sensible). */
export interface CandidatoResumenDto {
  id: string;
  nombres: string;
  apellidos: string;
}

export interface PostulacionResponseDto {
  id: string;
  candidatoId: string;
  /** Resumen para pintar la tarjeta del tablero (nunca cédula/email/teléfono). */
  candidato: CandidatoResumenDto;
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
 * Columnas de la PROPIA tabla (`SELECT` explícito, igual que el módulo
 * `uploads`): el SQL no usa `*`, así que cualquier columna nueva en BD no se
 * cuela en la respuesta hasta que se decida aquí cómo presentarla. Se usa en
 * los RETURNING de INSERT/UPDATE (un RETURNING no puede hacer JOIN).
 */
export const COLUMNAS_POSTULACION = `
  id, candidato_id, requerimiento_id, fase, estado, motivo_descarte,
  created_by, created_at, updated_at
`;

/**
 * Lista de columnas de LECTURA con alias `p.` + JOIN de resumen con
 * `candidatos` (`c.`). Los prefijos son OBLIGATORIOS: `candidatos` comparte
 * `id`, `created_by`, `created_at` y `updated_at` con `postulaciones`, así
 * que sin alias PostgreSQL rechazaría la consulta por ambigüedad.
 */
export const COLUMNAS_POSTULACION_CON_CANDIDATO = `
  p.id, p.candidato_id, p.requerimiento_id, p.fase, p.estado,
  p.motivo_descarte, p.created_by, p.created_at, p.updated_at,
  c.nombres AS nombres_candidato, c.apellidos AS apellidos_candidato
`;
