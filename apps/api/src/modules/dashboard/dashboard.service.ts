import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../database/database.service';
import type { AuthenticatedUser } from '../../common/guards/auth.guard';
import {
  type DashboardResponseDto,
  type DashboardConversionPageDto,
  type EmbudoFilaCruda,
  type FaseFilaCruda,
  type RequerimientosFilaCruda,
  armarPorFase,
} from './dto/dashboard.response';
import type { ListDashboardQueryDto } from './dto/list-dashboard-query.dto';

/**
 * Lógica del DASHBOARD de LARCO (Etapa 9, retroalimentación).
 *
 * Tres lecturas SIN escrituras ni transacciones: embudo de candidatos,
 * concentración por fase y contadores de requerimientos. Todo con el pool `pg`
 * GLOBAL (`DatabaseService`), igual que el resto de la API.
 *
 * Los `FILTER (WHERE ...)` dejan los conteos en UNA sola pasada por tabla
 * (mucho más barato que 5 consultas separadas y, sobre todo, consistente:
 * los números se calculan sobre el MISMO snapshot).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly database: DatabaseService) {}

  /** Embudo + por-fase + requerimientos, en una única respuesta coherente. */
  async resumen(
    query: ListDashboardQueryDto,
    user: AuthenticatedUser,
  ): Promise<DashboardResponseDto> {
    const alcance = this.alcance(user);
    const [embudo, porFila, requerimientos, conversionPorRequerimiento] = await Promise.all([
      this.leerEmbudo(alcance),
      this.database.query<FaseFilaCruda>(
        `SELECT fase, count(*)::int AS cantidad
           FROM postulaciones p
           JOIN candidatos c ON c.id = p.candidato_id
          WHERE p.estado = 'activa' ${alcance.candidatos}
          GROUP BY fase`,
        alcance.esLider ? alcance.params : [],
      ),
      this.leerRequerimientos(alcance),
      this.leerConversionPorRequerimiento(query, alcance),
    ]);

    const totalActivas = porFila.rows.reduce((suma, fila) => suma + fila.cantidad, 0);

    return {
      embudo,
      porFase: armarPorFase(porFila.rows, totalActivas),
      requerimientos,
      conversionPorRequerimiento,
    };
  }

  /**
   * Contadores del embudo de candidatos.
   *
   * `enProceso` excluye la fase `contratacion`: estar en la última columna ya
   * ES el contrato (el estado `contratado` lo confirma la transición final),
   * contarla aquí duplicaría el número en la tarjeta «Contratados».
   */
  private async leerEmbudo(alcance: Alcance): Promise<DashboardResponseDto['embudo']> {
    const [totales, postulaciones] = await Promise.all([
      this.database.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM candidatos c WHERE true ${alcance.candidatos}`,
        alcance.esLider ? alcance.params : [],
      ),
      this.database.query<EmbudoFilaCruda>(
        `SELECT count(*) FILTER (WHERE estado = 'activa' AND fase <> 'contratacion')::int AS en_proceso,
                count(*) FILTER (WHERE estado = 'contratado')::int AS contratados,
                count(*) FILTER (WHERE estado = 'descartado')::int AS descartados
           FROM postulaciones p
           JOIN candidatos c ON c.id = p.candidato_id
          WHERE true ${alcance.candidatos}`,
        alcance.esLider ? alcance.params : [],
      ),
    ]);
    return {
      totalCandidatos: totales.rows[0]?.total ?? 0,
      enProceso: postulaciones.rows[0]?.en_proceso ?? 0,
      contratados: postulaciones.rows[0]?.contratados ?? 0,
      descartados: postulaciones.rows[0]?.descartados ?? 0,
    };
  }

  /** Contadores de requerimientos; `criticos` son los urgentes aún abiertos. */
  private async leerRequerimientos(
    alcance: Alcance,
  ): Promise<DashboardResponseDto['requerimientos']> {
    const resultado = await this.database.query<RequerimientosFilaCruda>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE estado = 'aprobado')::int AS aprobados,
              count(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes,
              count(*) FILTER (WHERE estado = 'en_proceso')::int AS en_proceso,
              count(*) FILTER (WHERE urgencia = 'critica'
                                AND estado NOT IN ('cerrado', 'rechazado', 'exitoso'))::int AS criticos
         FROM requerimientos r
        WHERE true ${alcance.requerimientos}`,
      alcance.esLider ? alcance.params : [],
    );
    const fila = resultado.rows[0];
    return {
      total: fila?.total ?? 0,
      aprobados: fila?.aprobados ?? 0,
      pendientes: fila?.pendientes ?? 0,
      enProceso: fila?.en_proceso ?? 0,
      criticos: fila?.criticos ?? 0,
    };
  }

  /**
   * Conversión = contratados / postulaciones del requerimiento.
   * El denominador incluye postulaciones en cualquier estado para que la tasa
   * sea reproducible y no dependa de que el requerimiento siga abierto.
   */
  private async leerConversionPorRequerimiento(
    query: ListDashboardQueryDto,
    alcance: Alcance,
  ): Promise<DashboardConversionPageDto> {
    const [resultado, total] = await Promise.all([
      this.database.query<{
        requerimiento_id: string;
        codigo: string;
        titulo: string;
        postulaciones: number;
        contratados: number;
      }>(
        `SELECT r.id AS requerimiento_id,
              r.code AS codigo,
              r.titulo,
               count(c.id)::int AS postulaciones,
               count(c.id) FILTER (WHERE p.estado = 'contratado')::int AS contratados
         FROM requerimientos r
          LEFT JOIN postulaciones p ON p.requerimiento_id = r.id
          LEFT JOIN candidatos c ON c.id = p.candidato_id
             AND (true ${alcance.candidatos})
         WHERE true ${alcance.requerimientos}
         GROUP BY r.id, r.code, r.titulo
         ORDER BY r.created_at DESC, r.id ASC
         LIMIT $${alcance.esLider ? 2 : 1} OFFSET $${alcance.esLider ? 3 : 2}`,
        alcance.esLider
          ? [alcance.params[0], query.limit, (query.page - 1) * query.limit]
          : [query.limit, (query.page - 1) * query.limit],
      ),
      this.database.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM requerimientos r WHERE true ${alcance.requerimientos}`,
        alcance.esLider ? alcance.params : [],
      ),
    ]);
    return {
      items: resultado.rows.map((fila) => ({
        requerimientoId: fila.requerimiento_id,
        codigo: fila.codigo,
        titulo: fila.titulo,
        postulaciones: fila.postulaciones,
        contratados: fila.contratados,
        tasaContratacion:
          fila.postulaciones === 0
            ? 0
            : Math.round((fila.contratados / fila.postulaciones) * 10000) / 10000,
      })),
      total: total.rows[0]?.total ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * El área del candidato se determina por `candidatos.departamento_id`; para
   * requerimientos la autoridad histórica es el texto `jefatura`. Si un líder
   * no tiene jefatura, las condiciones deliberadamente no coinciden con nada.
   */
  private alcance(user: AuthenticatedUser): Alcance {
    if (user.role !== 'lider_area') {
      return { candidatos: '', requerimientos: '', params: [], esLider: false };
    }

    const candidato = `AND c.departamento_id IN (
      SELECT d.id FROM departamentos d
      JOIN users u ON u.id = $1
      WHERE u.active AND u.jefatura IS NOT NULL
        AND lower(btrim(u.jefatura)) = lower(btrim(d.nombre))
    )`;
    const requerimiento = `AND lower(btrim(r.jefatura)) = lower(btrim((
      SELECT u.jefatura FROM users u
      WHERE u.id = $1 AND u.active AND u.jefatura IS NOT NULL
    )))`;
    return {
      candidatos: candidato,
      requerimientos: requerimiento,
      params: [user.sub],
      esLider: true,
    };
  }
}

interface Alcance {
  candidatos: string;
  requerimientos: string;
  params: string[];
  esLider: boolean;
}
