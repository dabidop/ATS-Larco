import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '../../database/database.service';
import type { ActualizarEntrevistaDto } from './dto/actualizar-entrevista.dto';
import type { CrearEntrevistaDto } from './dto/crear-entrevista.dto';
import {
  COLUMNAS_ENTREVISTA,
  FROM_ENTREVISTA,
  type EntrevistaFilaCruda,
  type EntrevistaResponseDto,
  toResponse,
} from './dto/entrevista.response';
import type { ListarEntrevistasQueryDto } from './dto/listar-entrevistas-query.dto';

/** Máximo de entrevistas devueltas por listado (la agenda NO es infinita). */
const LIMITE_LISTADO = 200;

/** Estados terminales de una postulación (mismo criterio que el embudo). */
const ESTADOS_POSTULACION_TERMINALES = ['contratado', 'descartado'];

/**
 * Lógica de las ENTREVISTAS de LARCO (Etapa 9, retroalimentación).
 *
 * Una entrevista se agenda SOBRE una postulación (candidato dentro de un
 * requerimiento); el endpoint resuelve y devuelve también candidato y
 * requerimiento para pintar la agenda de una sola lectura. Con el pool `pg`
 * GLOBAL (`DatabaseService`), sin transacciones: cada escritura es UNA sentencia
 * con `RETURNING`, y `audit_log` lo escribe el trigger `entrevistas_audit_log`
 * (migración 009).
 */
@Injectable()
export class EntrevistasService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Agenda filtrable (fechas `desde`/`hasta` inclusivas, estado, postulación o
   * candidato; combinables con Y lógico), ordenada por fecha ascendente y hora
   * alfabética (`'09:00' < '13:00'`, el orden cronológico natural de `time`).
   */
  async listar(query: ListarEntrevistasQueryDto): Promise<EntrevistaResponseDto[]> {
    const condiciones: string[] = [];
    const parametros: unknown[] = [];
    const agregar = (sql: string, valor: unknown): void => {
      parametros.push(valor);
      condiciones.push(sql.replace('?', `$${parametros.length}`));
    };

    if (query.desde !== undefined) agregar('e.fecha >= ?::date', query.desde);
    if (query.hasta !== undefined) agregar('e.fecha <= ?::date', query.hasta);
    if (query.estado !== undefined) agregar('e.estado = ?', query.estado);
    if (query.postulacionId !== undefined) agregar('e.postulacion_id = ?', query.postulacionId);
    if (query.candidatoId !== undefined) agregar('p.candidato_id = ?', query.candidatoId);

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const resultado = await this.database.query<EntrevistaFilaCruda>(
      `SELECT ${COLUMNAS_ENTREVISTA}
         ${FROM_ENTREVISTA}
         ${where}
        ORDER BY e.fecha ASC, e.hora ASC NULLS FIRST, e.created_at ASC
        LIMIT ${LIMITE_LISTADO}`,
      parametros,
    );
    return resultado.rows.map(toResponse);
  }

  /**
   * Crea la entrevista → **201** con la fila + candidato + requerimiento.
   *
   * **404** si la postulación no existe; **409** si es TERMINAL (`contratado` o
   * `descartado`): no se agendan entrevistas para candidatos ya contratados o
   * descartados (la postulación cerró; si reaparece, será otra selección).
   */
  async crear(dto: CrearEntrevistaDto, actor: string): Promise<EntrevistaResponseDto> {
    // El check y el INSERT viven en la MISMA transacción. `FOR UPDATE` toma el
    // bloqueo de la fila que también adquiere el UPDATE del embudo; así, si una
    // transición terminal gana la carrera, el check ve el estado terminal, y si
    // esta operación gana, queda linealizada antes de esa transición. El GUC es
    // SET LOCAL para que el trigger de auditoría registre al actor real.
    const id = await this.database.withTransaction(async (cliente) => {
      await cliente.query(`SELECT set_config('app.current_user_id', $1, true)`, [actor]);
      const postulacion = await cliente.query<{ estado: string }>(
        'SELECT estado FROM postulaciones WHERE id = $1 FOR UPDATE',
        [dto.postulacionId],
      );
      const fila = postulacion.rows[0];
      if (fila === undefined) {
        throw new NotFoundException(`No existe una postulación con id ${dto.postulacionId}`);
      }
      if (ESTADOS_POSTULACION_TERMINALES.includes(fila.estado)) {
        throw new ConflictException(
          `La postulación está en estado «${fila.estado}» (terminal): no se pueden agendar entrevistas sobre ella`,
        );
      }

      // El INSERT solo devuelve `id`: los JOINs de candidato/requerimiento no
      // están en scope de un INSERT, así que la fila completa se RELEE.
      const insert = await cliente.query<{ id: string }>(
        `INSERT INTO entrevistas (postulacion_id, fecha, hora, tipo, entrevistador, estado, notas, created_by)
         VALUES ($1, $2::date, $3::time, $4, $5, COALESCE($6::estado_entrevista, 'agendada'), $7, $8)
         RETURNING id`,
        [
          dto.postulacionId,
          dto.fecha,
          dto.hora ?? null,
          dto.tipo.trim(),
          dto.entrevistador ?? null,
          dto.estado ?? null,
          dto.notas ?? null,
          actor,
        ],
      );
      return insert.rows[0]?.id;
    });
    if (id === undefined) {
      throw new NotFoundException('La entrevista creada no se pudo leer de vuelta');
    }
    return this.leer(id);
  }

  /**
   * Actualiza los campos informados → **200** con la fila vigente.
   *
   * **404** si la entrevista no existe. Los `null` limpiian el campo (p. ej.
   * `hora: null` deja la entrevista «solo con día»).
   */
  async actualizar(id: string, dto: ActualizarEntrevistaDto): Promise<EntrevistaResponseDto> {
    const campos: string[] = [];
    const parametros: unknown[] = [];
    const agregar = (columna: string, valor: unknown, casteo = ''): void => {
      parametros.push(valor);
      campos.push(`${columna} = $${parametros.length}${casteo}`);
    };

    if (dto.fecha !== undefined) agregar('fecha', dto.fecha, '::date');
    if (dto.hora !== undefined) agregar('hora', dto.hora, '::time');
    if (dto.tipo !== undefined) agregar('tipo', dto.tipo.trim());
    if (dto.entrevistador !== undefined) agregar('entrevistador', dto.entrevistador);
    if (dto.estado !== undefined) agregar('estado', dto.estado);
    if (dto.notas !== undefined) agregar('notas', dto.notas);

    if (campos.length > 0) {
      // El `id` se empuja AL FINAL para que su número de placeholder no choque
      // con los de los SET ($1 ya está ocupado por el primer campo informado).
      parametros.push(id);
      const resultado = await this.database.query<unknown[]>(
        `UPDATE entrevistas SET ${campos.join(', ')} WHERE id = $${parametros.length}`,
        parametros,
      );
      if (resultado.rowCount === 0) {
        throw new NotFoundException(`No existe una entrevista con id ${id}`);
      }
    }

    return this.leer(id);
  }

  /** Relee una entrevista con sus JOINs → **404** si ya no existe. */
  private async leer(id: string): Promise<EntrevistaResponseDto> {
    const lectura = await this.database.query<EntrevistaFilaCruda>(
      `SELECT ${COLUMNAS_ENTREVISTA} ${FROM_ENTREVISTA} WHERE e.id = $1`,
      [id],
    );
    const fila = lectura.rows[0];
    if (fila === undefined) {
      throw new NotFoundException(`No existe una entrevista con id ${id}`);
    }
    return toResponse(fila);
  }
}
