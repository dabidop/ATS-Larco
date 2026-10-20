/**
 * Forma PÚBLICA de un candidato tal y como sale por la API (camelCase).
 *
 * Es la contraparte de la respuesta: la entidad `Candidato` mapea la tabla
 * `candidatos` (snake_case en BD) con tipos de TypeORM y guarda la PII
 * CIFRADA, mientras que aquí se fija qué ve el cliente.
 *
 * LA PII SE DEVUELVE DESCIFRADA (`cedula`, `telefono`): el cliente
 * autenticado con permiso sobre el módulo puede verla. Lo que NUNCA sale por
 * la API son `cedulaHash` (hash interno de búsqueda) ni los campos cifrados
 * `cedulaCifrada`/`telefonoCifrada`: son detalles de persistencia, no datos
 * para el cliente. Por eso este DTO no los declara.
 */
export interface CandidatoResponseDto {
  id: string;
  nombres: string;
  apellidos: string;
  email: string | null;
  /** Cédula DESCIFRADA (en claro) para el cliente autenticado. */
  cedula: string;
  /** Teléfono DESCIFRADO (en claro); `null` si el candidato no tiene. */
  telefono: string | null;
  ciudad: string | null;
  cargoActual: string | null;
  expectativaSalarial: number | null;
  disponibilidad: string | null;
  notas: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Respuesta paginada de `GET /api/candidatos`. */
export interface CandidatosPageDto {
  items: CandidatoResponseDto[];
  /** Total de filas que cumplen el filtro (independiente de la página). */
  total: number;
  page: number;
  limit: number;
}
