/**
 * Forma PÚBLICA de un departamento LARCO con sus estadísticas de embudo
 * (Etapa 9, pantalla «Departamentos» de la muestra: tarjeta con coordinador,
 * contador de candidatos y contador de requerimientos).
 */
export interface DepartamentoResponseDto {
  id: string;
  nombre: string;
  coordinador: string;
  /** Candidatos etiquetados con este área (`candidatos.departamento_id`). */
  totalCandidatos: number;
  /** Requerimientos del área (cualquier estado). */
  totalRequerimientos: number;
  /** De ellos, los que están exactamente en `aprobado` (tag «N aprob.»). */
  requerimientosAprobados: number;
}

/** Fila cruda del listado con conteos (pg devuelve los enteros como number). */
export interface DepartamentoFilaCruda {
  id: string;
  nombre: string;
  coordinador: string;
  total_candidatos: number;
  total_requerimientos: number;
  requerimientos_aprobados: number;
}

/** Fila cruda → respuesta (camelCase). */
export function toResponse(fila: DepartamentoFilaCruda): DepartamentoResponseDto {
  return {
    id: fila.id,
    nombre: fila.nombre,
    coordinador: fila.coordinador,
    totalCandidatos: fila.total_candidatos,
    totalRequerimientos: fila.total_requerimientos,
    requerimientosAprobados: fila.requerimientos_aprobados,
  };
}
