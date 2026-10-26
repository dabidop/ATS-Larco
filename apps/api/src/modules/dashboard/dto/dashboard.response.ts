import { FASES } from '../../embudo/postulaciones-fases';

/**
 * Embudo de candidatos (Etapa 9, pantalla «Dashboard» de la muestra).
 *
 * Cada candidato tiene a lo sumo UNA postulación (`UNIQUE(candidato_id)` desde
 * la migración 009), así que los contadores NO se solapan:
 *
 *  - `enProceso`: postulación `activa` fuera de la fase final.
 *  - `contratados`: postulación en estado terminal `contratado`.
 *  - `descartados`: postulación en estado terminal `descartado`.
 */
export interface DashboardEmbudoDto {
  /** Total de filas en `candidatos` (incluye los que aún sin postulación). */
  totalCandidatos: number;
  enProceso: number;
  descartados: number;
  contratados: number;
}

/** Concentración del embudo ACTIVO en una de las 5 fases. */
export interface DashboardFaseDto {
  /** Clave de la fase en BD (`preseleccion`, `antecedentes`, ...). */
  fase: string;
  /** Postulaciones `activas` actualmente en la fase. */
  cantidad: number;
  /**
   * Proporción (0–1, 2 decimales) del embudo activo que está en esta fase:
   * `cantidad / total de activas`. Es la métrica que dibuja la barra del
   * embudo; los terminales (`contratado`/`descartado`) no cuentan.
   */
  tasaRetencion: number;
}

/** Contadores de requerimientos por estado + críticos abiertos. */
export interface DashboardRequerimientosDto {
  total: number;
  aprobados: number;
  pendientes: number;
  enProceso: number;
  /** Urgencia `critica` y AÚN sin desenlace (ni cerrado, rechazado ni exitoso). */
  criticos: number;
}

/** Respuesta de `GET /api/dashboard`. */
export interface DashboardResponseDto {
  embudo: DashboardEmbudoDto;
  /** Las 5 fases SIEMPRE en orden de avance, incluso con cantidad 0. */
  porFase: DashboardFaseDto[];
  requerimientos: DashboardRequerimientosDto;
}

/** Fila cruda de la consulta de embudo. */
export interface EmbudoFilaCruda {
  en_proceso: number;
  contratados: number;
  descartados: number;
}

/** Fila cruda de la consulta de requerimientos. */
export interface RequerimientosFilaCruda {
  total: number;
  aprobados: number;
  pendientes: number;
  en_proceso: number;
  criticos: number;
}

/** Fila cruda del conteo por fase. */
export interface FaseFilaCruda {
  fase: string;
  cantidad: number;
}

/**
 * Agrega el embudo en memoria: `FASES` (el orden canónico del ENUM) guía el
 * resultado, rellenando con 0 las fases sin postulaciones para que el dashboard
 * SIEMPRE tenga las 5 barras en el mismo orden que el tablero.
 */
export function armarPorFase(filas: FaseFilaCruda[], totalActivas: number): DashboardFaseDto[] {
  const porClave = new Map(filas.map((fila) => [fila.fase, fila.cantidad]));
  return FASES.map((fase) => {
    const cantidad = porClave.get(fase) ?? 0;
    const tasa = totalActivas === 0 ? 0 : Math.round((cantidad / totalActivas) * 100) / 100;
    return { fase, cantidad, tasaRetencion: tasa };
  });
}
