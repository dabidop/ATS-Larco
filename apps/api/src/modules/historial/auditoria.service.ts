import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../database/database.service';
import type { AuditoriaQueryDto } from './dto/auditoria.query.dto';
import {
  type AuditoriaFilaCruda,
  type AuditoriaPageDto,
  toResponse,
} from './dto/auditoria.response';

/** Página por defecto y límite duro (mismos números que el DTO). */
const PAGINA_POR_DEFECTO = 1;
const LIMITE_POR_DEFECTO = 50;

/**
 * Lógica de la BITÁCORA de auditoría (Etapa 9, regla 7 de la retroalimentación).
 *
 * `audit_log` lo escribe SOLO el trigger `audit_fila()` (migración 004) desde
 * cada tabla auditada; aquí SOLO se LEE, con el índice `audit_log(created_at)`
 * para el orden descendente. El email del actor se resuelve con un LEFT JOIN a
 * `users` y se devuelve JUNTO AL uuid crudo de `changed_by` (fuente de verdad).
 *
 * PRIVACIDAD: el diff es genérico sobre los jsonb `old_data`/`new_data`, pero
 * cualquier clave de PII cifrada o hash (`*_cifrada(s)`, `*_hash`) sale como
 * `[PROTEGIDO]` (`diffAuditoria`): la bitácora demuestra QUÉ cambió sin nunca
 * filtrar un secreto. El endpoint está restringido a `superusuario`.
 */
@Injectable()
export class AuditoriaService {
  constructor(private readonly database: DatabaseService) {}

  /** Página de la bitácora (más reciente primero) con los filtros combinables. */
  async listar(query: AuditoriaQueryDto): Promise<AuditoriaPageDto> {
    const pagina = query.pagina ?? PAGINA_POR_DEFECTO;
    const limite = query.limite ?? LIMITE_POR_DEFECTO;

    const condiciones: string[] = [];
    const parametros: unknown[] = [];
    const agregar = (sql: string, valor: unknown): void => {
      parametros.push(valor);
      condiciones.push(sql.replace('?', `$${parametros.length}`));
    };

    if (query.tabla !== undefined) agregar('a.table_name = ?', query.tabla);
    if (query.actor !== undefined) agregar('a.changed_by = ?', query.actor);
    if (query.recordId !== undefined) agregar('a.record_id = ?', query.recordId);
    if (query.desde !== undefined) agregar('a.created_at >= ?::timestamptz', query.desde);
    if (query.hasta !== undefined) agregar('a.created_at <= ?::timestamptz', query.hasta);

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

    const [conteo, filas] = await Promise.all([
      this.database.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM audit_log a ${where}`,
        parametros,
      ),
      this.database.query<AuditoriaFilaCruda>(
        `SELECT a.id, a.table_name, a.record_id, a.action,
                a.old_data, a.new_data, a.changed_by, a.created_at,
                u.email AS actor_email
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.changed_by
           ${where}
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $${parametros.length + 1} OFFSET $${parametros.length + 2}`,
        [...parametros, limite, (pagina - 1) * limite],
      ),
    ]);

    const total = conteo.rows[0]?.total ?? 0;
    return {
      entradas: filas.rows.map(toResponse),
      total,
      pagina,
      paginas: Math.max(1, Math.ceil(total / limite)),
    };
  }
}
