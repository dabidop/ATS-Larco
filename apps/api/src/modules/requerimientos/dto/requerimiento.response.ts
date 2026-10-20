import type { EstadoRequerimiento } from '../requerimiento.entity';

/**
 * Forma PÚBLICA de un requerimiento tal y como sale por la API (camelCase).
 *
 * Es la contraparte de la respuesta: la entidad `Requerimiento` mapea la tabla
 * `requerimientos` (snake_case en BD) con tipos de TypeORM, mientras que aquí
 * se fija qué ve el cliente. `code`, `estado`, `createdBy` y `motivoRechazo`
 * son de SOLO LECTURA para el cliente: el DTO de entrada no los acepta.
 */
export interface RequerimientoResponseDto {
  id: string;
  code: string;
  estado: EstadoRequerimiento;
  createdBy: string;
  // Sección 1 — identificación y jefatura
  titulo: string;
  jefatura: string;
  numeroPlazas: number;
  ubicacion: string | null;
  /** `'YYYY-MM-DD'`: la columna `date` se hidrata como string, no como Date. */
  fechaRequerida: string | null;
  // Sección 2 — perfil profesional
  experienciaRequerida: string | null;
  nivelEducacion: string | null;
  perfilProfesional: string;
  // Sección 3 — conocimientos y habilidades
  conocimientos: string[];
  habilidades: string[];
  // Sección 4 — condiciones salariales y contractuales
  salarioMin: number | null;
  salarioMax: number | null;
  tipoContrato: string | null;
  jornada: string | null;
  // Sección 5 — justificación
  justificacion: string;
  motivoRechazo: string | null;
  // Control temporal (ISO 8601, UTC)
  createdAt: string;
  updatedAt: string;
}

/** Respuesta paginada de `GET /api/requerimientos`. */
export interface RequerimientosPageDto {
  items: RequerimientoResponseDto[];
  /** Total de filas que cumplen el filtro (independiente de la página). */
  total: number;
  page: number;
  limit: number;
}
