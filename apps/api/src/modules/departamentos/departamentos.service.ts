import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../../database/database.service';
import type { ActualizarDepartamentoDto } from './dto/actualizar-coordinador.dto';
import {
  type DepartamentoFilaCruda,
  type DepartamentoResponseDto,
  toResponse,
} from './dto/departamento.response';

/**
 * Lógica de los DEPARTAMENTOS de LARCO (Etapa 9, retroalimentación).
 *
 * El catálogo es FIJO (seed de la migración 009: 8 áreas con su coordinador):
 * la API solo LEE el listado con estadísticas y ACTUALIZA el coordinador. El
 * módulo es un LECTOR de `candidatos` y `requerimientos` (sus conteos), no
 * gestiona altas ni bajas de áreas.
 *
 * Persistencia con el pool `pg` GLOBAL (`DatabaseService`, como el embudo):
 * dos `LEFT JOIN` con `GROUP BY` devuelven los conteos por área; los departamentos
 * sin registros quedan en 0 gracias a `COALESCE`.
 */
@Injectable()
export class DepartamentosService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Listado de las 8 áreas con sus estadísticas, ordenado por `nombre`.
   *
   * `totalCandidatos` cuenta filas de `candidatos` con `departamento_id` del
   * área; `totalRequerimientos` cuenta TODOS los requerimientos del área y
   * `requerimientosAprobados` solo los que están en estado `aprobado` (el tag
   * «N aprob.» de la pantalla de la muestra).
   */
  async listar(): Promise<DepartamentoResponseDto[]> {
    const resultado = await this.database.query<DepartamentoFilaCruda>(
      `SELECT d.id,
              d.nombre,
              d.coordinador,
              COALESCE(c.total, 0) AS total_candidatos,
              COALESCE(r.total, 0) AS total_requerimientos,
              COALESCE(r.aprobados, 0) AS requerimientos_aprobados
         FROM departamentos d
         LEFT JOIN (
           SELECT departamento_id, count(*)::int AS total
             FROM candidatos
            WHERE departamento_id IS NOT NULL
            GROUP BY departamento_id
         ) c ON c.departamento_id = d.id
         LEFT JOIN (
           SELECT departamento_id,
                  count(*)::int AS total,
                  count(*) FILTER (WHERE estado = 'aprobado')::int AS aprobados
             FROM requerimientos
            WHERE departamento_id IS NOT NULL
            GROUP BY departamento_id
         ) r ON r.departamento_id = d.id
        ORDER BY d.nombre ASC`,
    );
    return resultado.rows.map(toResponse);
  }

  /**
   * Actualiza el coordinador del área → **200** con el item actualizado.
   *
   * **404** si el departamento no existe. La escritura fija el GUC del actor
   * (migración 004): `audit_log.changed_by` registra QUIÉN cambió al
   * coordinador.
   */
  async actualizar(
    id: string,
    dto: ActualizarDepartamentoDto,
    actor: string,
  ): Promise<DepartamentoResponseDto> {
    return this.conActorDeAuditoria(actor, async (cliente) => {
      const resultado = await cliente.query<DepartamentoFilaCruda>(
        `UPDATE departamentos
            SET coordinador = $1
          WHERE id = $2
          RETURNING id, nombre, coordinador,
                    0::int AS total_candidatos,
                    0::int AS total_requerimientos,
                    0::int AS requerimientos_aprobados`,
        [dto.coordinador.trim(), id],
      );
      const fila = resultado.rows[0];
      if (fila === undefined) {
        throw new NotFoundException(`No existe un departamento con id ${id}`);
      }
      // Los conteos del RETURNING son 0: se releen para no inventar datos.
      return this.leerItem(cliente, id);
    });
  }

  /** Relee UN área con sus conteos (misma forma que el listado). */
  private async leerItem(cliente: PoolClient, id: string): Promise<DepartamentoResponseDto> {
    const resultado = await cliente.query<DepartamentoFilaCruda>(
      `SELECT d.id,
              d.nombre,
              d.coordinador,
              COALESCE(c.total, 0) AS total_candidatos,
              COALESCE(r.total, 0) AS total_requerimientos,
              COALESCE(r.aprobados, 0) AS requerimientos_aprobados
         FROM departamentos d
         LEFT JOIN (
           SELECT departamento_id, count(*)::int AS total
             FROM candidatos
            WHERE departamento_id IS NOT NULL
            GROUP BY departamento_id
         ) c ON c.departamento_id = d.id
         LEFT JOIN (
           SELECT departamento_id,
                  count(*)::int AS total,
                  count(*) FILTER (WHERE estado = 'aprobado')::int AS aprobados
             FROM requerimientos
            WHERE departamento_id IS NOT NULL
            GROUP BY departamento_id
         ) r ON r.departamento_id = d.id
        WHERE d.id = $1`,
      [id],
    );
    const fila = resultado.rows[0];
    if (fila === undefined) {
      throw new NotFoundException(`No existe un departamento con id ${id}`);
    }
    return toResponse(fila);
  }

  /**
   * Ejecuta `fn` dentro de UNA transacción que fija el GUC
   * `app.current_user_id` con el `sub` del JWT (migración 004). Réplica del
   * patrón de `PostulacionesService.conActorDeAuditoria`.
   */
  private async conActorDeAuditoria<T>(
    actor: string,
    fn: (cliente: PoolClient) => Promise<T>,
  ): Promise<T> {
    const cliente = await this.database.pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(`SELECT set_config('app.current_user_id', $1, true)`, [actor]);
      const resultado = await fn(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }
}
