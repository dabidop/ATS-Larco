import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../../database/database.service';
import type { CreatePostulacionDto } from './dto/create-postulacion.dto';
import type { DescartarPostulacionDto } from './dto/descartar-postulacion.dto';
import type { ListPostulacionesQueryDto } from './dto/list-postulaciones-query.dto';
import type { MoverFaseDto } from './dto/mover-fase.dto';
import {
  COLUMNAS_POSTULACION,
  COLUMNAS_POSTULACION_CON_CANDIDATO,
  type PostulacionFilaCruda,
  type PostulacionResponseDto,
  type PostulacionRow,
  type PostulacionesPageDto,
} from './dto/postulacion.response';
import {
  FASE_CONTRATACION,
  esRetroceso,
  esSiguiente,
  esTerminal,
  estadoTrasMover,
  mensajeFaseActual,
  mensajeNoAdyacente,
  mensajeRetroceso,
  mensajeTerminal,
  type Estado,
  type Fase,
} from './postulaciones-fases';
import {
  LIMITE_HISTORIAL,
  mapearEntradaHistorial,
  toResponse,
  type EntradaHistorialPostulacionDto,
  type FilaAuditoriaPostulacion,
} from './postulaciones.mapper';

/** Nombre EXACTO de la constraint única creada en la migración 009 (1 candidato = 1 requerimiento). */
const UNIQUE_POSTULACION = 'postulaciones_candidato_unico';

/** Único estado del requerimiento en el que se selecciona personal (ENUM de 003). */
const REQUERIMIENTO_EN_PROCESO = 'en_proceso';

/** Estado del requerimiento «Contrato exitoso» (ENUM 009; solo lo pone el servicio). */
const REQUERIMIENTO_EXITOSO = 'exitoso';

/** Mensaje de duplicado, compartido por el chequeo previo y el 23505 de BD. */
const MENSAJE_DUPLICADO = (candidatoId: string): string =>
  `El candidato ${candidatoId} ya pertenece a un requerimiento: ` +
  `un candidato solo puede estar en UNO (regla de negocio)`;

/** Forma mínima del error de BD que interesa (pg copia `code`/`constraint`). */
interface ErrorConConstraint {
  code?: string;
  constraint?: string;
}

/**
 * ¿Es una violación de UNICIDAD (23505) de PostgreSQL sobre la constraint dada?
 * `node-postgres` copia los campos del ErrorResponse sobre el `Error`, así que
 * `code` y `constraint` están en el propio objeto (mismo patrón que
 * `ArchivosCvService`).
 */
function esViolacionUnica(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const e = error as ErrorConConstraint;
  return e.code === '23505' && e.constraint === constraint;
}

/**
 * Casos de uso de las postulaciones: el embudo de selección por 5 fases
 * (Fase 5, parte backend).
 *
 * Persistencia con el pool `pg` GLOBAL (`DatabaseService`), igual que `uploads`,
 * y NO con TypeORM: `postulaciones` es una tabla AUTOCONTENIDA (dos FK, la
 * fase, el estado y el motivo de descarte) y este módulo así no necesita
 * DataSource propio ni crear un ciclo de módulos con `CandidatosModule` ni con
 * `RequerimientosModule` —ni siquiera importa sus entidades: si necesita
 * comprobar algo de un candidato o de un requerimiento, lo consulta por SQL
 * crudo en la MISMA base de datos.
 *
 * Invariantes que sostiene (además de los CHECK y el índice único de la 007/009):
 *  - Toda postulación NACE en `preseleccion`/`activa` (defaults de la columna;
 *    el cliente no elige ni la fase ni el estado).
 *  - Solo se postula a un requerimiento en `en_proceso` (la selección se
 *    ejecuta durante la fase activa del requerimiento) → 409 en otro estado.
 *  - Un candidato pertenece a UN solo requerimiento (reglas 6 y 8 de la
 *    retroalimentación, Etapa 9) → 409 si ya está en cualquier otro; el índice
 *    único `postulaciones_candidato_unico` (migración 009) cierra la carrera.
 *  - Un movimiento solo avanza UN paso hacia adelante (el embudo NO retrocede,
 *    regla 11 de la retroalimentación); saltar o devolver → 409.
 *  - Llegar a `contratacion` ES contratar: `estado = 'contratado'` (terminal)
 *    en la MISMA escritura. El cupo de `numero_plazas` manda: no se mueve a
 *    contratación ni se aceptan candidatos cuando ya está cubierto (reglas 3 y
 *    4), y al llenar la última plaza el requerimiento pasa SOLO a `exitoso`
 *    («Contrato exitoso», auditado con el actor que movió).
 *  - Descartar exige motivo y deja la fila en `descartado` (terminal). El
 *    CHECK `postulaciones_descarte_check` es la red de seguridad final.
 *
 * AUDITORÍA: cada escritura va dentro de una transacción que fija el GUC
 * `app.current_user_id` con el `sub` del JWT (migración 004, patrón de
 * `uploads`), de modo que `audit_log.changed_by` registra a QUIÉN mueve la
 * fase o descarta, y no al autor del alta.
 */
@Injectable()
export class PostulacionesService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Crea una postulación → **201** en `preseleccion`/`activa`.
   *
   * Orden y fallos (en este ORDEN, a propósito):
   *  1. **404** si no existe el candidato.
   *  2. **404** si no existe el requerimiento.
   *  3. **409** si el requerimiento NO está `en_proceso`: solo se selecciona
   *     durante la fase activa del requerimiento (en `pendiente` aún no se
   *     ha aprobado; en `cerrado`/`rechazado`/`exitoso` la vacante ya no se
   *     cubre).
   *  4. **409** si el candidato YA pertenece a OTRO requerimiento (regla 8,
   *     Etapa 9: un candidato = un requerimiento; chequeo previo para responder
   *     sin llegar a la constraint `postulaciones_candidato_unico`, que cubre
   *     la carrera).
   *  5. **409** si el requerimiento ya cubrió sus plazas (regla 4: no se
   *     aceptan más candidatos cuando la sección de contratación está llena).
   *  6. INSERT dentro de la transacción con el GUC del actor: `fase` y
   *     `estado` NO se escriben — son los defaults de las columnas.
   */
  async crear(dto: CreatePostulacionDto, createdBy: string): Promise<PostulacionResponseDto> {
    const candidato = await this.resumenDelCandidato(dto.candidatoId);

    const requerimiento = await this.datosDelRequerimiento(dto.requerimientoId);
    if (requerimiento.estado !== REQUERIMIENTO_EN_PROCESO) {
      throw new ConflictException(
        `Solo se pueden registrar postulaciones en requerimientos en proceso: ` +
          `el requerimiento ${dto.requerimientoId} está en '${requerimiento.estado}'`,
      );
    }

    const mensajeDuplicado = MENSAJE_DUPLICADO(dto.candidatoId);
    const existente = await this.database.query('SELECT 1 FROM postulaciones WHERE candidato_id = $1', [
      dto.candidatoId,
    ]);
    if ((existente.rowCount ?? 0) > 0) {
      throw new ConflictException(mensajeDuplicado);
    }

    const contratados = await this.contratadosDelRequerimiento(dto.requerimientoId);
    if (contratados >= requerimiento.numeroPlazas) {
      throw new ConflictException(
        `El requerimiento ${dto.requerimientoId} ya cubrió sus ${requerimiento.numeroPlazas} ` +
          `plaza(s): no se aceptan más candidatos (sección de contratación llena)`,
      );
    }

    try {
      const fila = await this.conActorDeAuditoria(createdBy, (cliente) =>
        this.insertarFila(cliente, dto.candidatoId, dto.requerimientoId, createdBy),
      );
      if (fila === undefined) {
        // Imposible en la práctica: un INSERT con RETURNING siempre devuelve fila.
        throw new Error('El INSERT sobre postulaciones no devolvió ninguna fila');
      }
      // El RETURNING no puede hacer JOIN: se fusiona el resumen del candidato
      // verificado ARRIBA (un candidato no cambia de nombre mientras existe
      // la postulación, y `candidato_id` es inmutable).
      return toResponse({
        ...fila,
        nombres_candidato: candidato.nombres,
        apellidos_candidato: candidato.apellidos,
      });
    } catch (error) {
      // Carrera: dos peticiones simultáneas crearon la MISMA postulación.
      if (esViolacionUnica(error, UNIQUE_POSTULACION)) {
        throw new ConflictException(mensajeDuplicado);
      }
      throw error;
    }
  }

  /**
   * Listado paginado ordenado por `created_at DESC`, con filtros combinables
   * (AND): `requerimientoId` (el tablero Kanban), `candidatoId`, `fase` y
   * `estado`. El total se cuenta con el MISMO `WHERE`, así que `total` es
   * siempre el de la página completa y no el de la página servida.
   */
  async listar(query: ListPostulacionesQueryDto): Promise<PostulacionesPageDto> {
    const condiciones: string[] = [];
    const params: unknown[] = [];

    if (query.requerimientoId !== undefined) {
      params.push(query.requerimientoId);
      condiciones.push(`p.requerimiento_id = $${params.length}`);
    }
    if (query.candidatoId !== undefined) {
      params.push(query.candidatoId);
      condiciones.push(`p.candidato_id = $${params.length}`);
    }
    if (query.fase !== undefined) {
      params.push(query.fase);
      condiciones.push(`p.fase = $${params.length}`);
    }
    if (query.estado !== undefined) {
      params.push(query.estado);
      condiciones.push(`p.estado = $${params.length}`);
    }

    const where = condiciones.length === 0 ? '' : `WHERE ${condiciones.join(' AND ')}`;

    const conteo = await this.database.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM postulaciones p ${where}`,
      params,
    );

    // `id ASC` como desempate: dos filas con el MISMO created_at (resolución de
    // microsegundos) mantienen un orden estable y determinista entre páginas.
    const filas = await this.database.query<PostulacionRow>(
      `SELECT ${COLUMNAS_POSTULACION_CON_CANDIDATO}
         FROM postulaciones p
         JOIN candidatos c ON c.id = p.candidato_id
        ${where}
        ORDER BY p.created_at DESC, p.id ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );

    return {
      items: filas.rows.map((fila) => toResponse(fila)),
      total: conteo.rows[0]?.total ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Detalle por id; 404 con mensaje claro si no existe. */
  async findById(id: string): Promise<PostulacionResponseDto> {
    return toResponse(await this.cargarPostulacion(id));
  }

  /**
   * Mueve la postulación a otra fase → **200** con la fila ACTUALIZADA.
   *
   * Reglas, en este orden (todas las denegaciones son 409, ninguna escribe):
   *  1. **404** si la postulación no existe.
   *  2. **409** si el estado es TERMINAL (`contratado`/`descartado`): el
   *     desenlace ya está decidido, el embudo no se mueve más.
   *  3. **409** si la fase destino es la MISMA que la actual.
   *  4. **409** si la fase destino es un RETROCESO (el embudo SOLO AVANZA,
   *     regla 11 de la retroalimentación, Etapa 9).
   *  5. **409** si la fase destino NO es la SIGUIENTE (no se saltan fases).
   *  6. Al mover a `contratacion` (y SOLO en ese caso): se bloquea la fila del
   *     requerimiento (`SELECT ... FOR UPDATE`) y se cuenta el cupo — si ya
   *     está lleno, **409** (regla 4: no se mueve nadie más a contratación).
   *  7. Escritura dentro de la transacción con el GUC del actor, con criterio
   *     `estado = <leído>` como blindaje ante carreras: si otra petición
   *     cambió la postulación en medio, `rowCount = 0` → 409.
   *  8. Si tras el movimiento las contrataciones CUBREN las plazas, el
   *     requerimiento pasa SOLO a `exitoso` («Contrato exitoso», regla 3) en
   *     la MISMA transacción: el trigger de auditoría lo registra con el
   *     actor que movió. El `UPDATE` del paso 8 lleva criterio
   *     `estado = 'en_proceso'`, así que no pisa un cierre simultáneo.
   *
   * El estado RESULTANTE lo decide `estadoTrasMover`: destino `contratacion`
   * ⇒ `contratado` (llegar allí ES contratar, y es terminal); el resto ⇒
   * sigue `activa`.
   */
  async cambiarFase(id: string, dto: MoverFaseDto, actor: string): Promise<PostulacionResponseDto> {
    const fila = await this.cargarPostulacion(id);
    const faseActual = fila.fase as Fase;
    const estado = fila.estado as Estado;

    if (esTerminal(estado)) {
      throw new ConflictException(mensajeTerminal(estado, 'nuevos movimientos de fase'));
    }
    if (dto.fase === faseActual) {
      throw new ConflictException(mensajeFaseActual(dto.fase));
    }
    if (esRetroceso(faseActual, dto.fase)) {
      throw new ConflictException(mensajeRetroceso(faseActual, dto.fase));
    }
    if (!esSiguiente(faseActual, dto.fase)) {
      throw new ConflictException(mensajeNoAdyacente(faseActual, dto.fase));
    }

    const nuevoEstado = estadoTrasMover(dto.fase);
    const esContratacion = dto.fase === FASE_CONTRATACION;

    return this.conActorDeAuditoria(actor, async (cliente) => {
      if (esContratacion) {
        await this.assertCupoDisponible(cliente, fila.requerimiento_id);
      }

      const resultado = await cliente.query<PostulacionFilaCruda>(
        `UPDATE postulaciones
            SET fase = $1, estado = $2
          WHERE id = $3 AND estado = $4
          RETURNING ${COLUMNAS_POSTULACION}`,
        [dto.fase, nuevoEstado, id, estado],
      );
      const actualizada = resultado.rows[0];
      if (actualizada === undefined) {
        throw new ConflictException(
          `Conflicto: la postulación cambió mientras se procesaba el movimiento ` +
            `a '${dto.fase}'; vuelve a intentarlo`,
        );
      }

      if (esContratacion) {
        await this.marcarExitosoSiCupoLleno(cliente, fila.requerimiento_id);
      }

      // El RETURNING no puede hacer JOIN: el resumen del candidato se toma de
      // la LECTURA inicial (`candidato_id` es inmutable, migración 007).
      return toResponse({
        ...actualizada,
        nombres_candidato: fila.nombres_candidato,
        apellidos_candidato: fila.apellidos_candidato,
      });
    });
  }

  /**
   * Descarta la postulación desde CUALQUIER fase → **200** con la fila en
   * estado `descartado` (terminal).
   *
   * Reglas, en este orden:
   *  1. **400** si el motivo queda vacío tras recortarlo (el DTO ya exige
   *     texto; aquí se cierra el caso `'   '`).
   *  2. **404** si la postulación no existe.
   *  3. **409** si el estado es TERMINAL (ya contratada o ya descartada).
   *  4. Escritura con el GUC del actor y criterio `estado = 'activa'`
   *     (blindaje ante carreras, igual que `cambiarFase`).
   *
   * El CHECK `postulaciones_descarte_check` de la migración 007 garantiza en
   * BD que `descartado` ⇒ motivo poblado: si aquí se colara un descarte sin
   * motivo, PostgreSQL respondería con un error y la transacción haría
   * ROLLBACK (nunca un 500 silencioso con la fila a medias).
   */
  async descartar(
    id: string,
    dto: DescartarPostulacionDto,
    actor: string,
  ): Promise<PostulacionResponseDto> {
    const motivo = dto.motivo.trim();
    if (motivo === '') {
      throw new BadRequestException('El motivo de descarte es obligatorio');
    }

    const fila = await this.cargarPostulacion(id);
    const estado = fila.estado as Estado;
    if (esTerminal(estado)) {
      throw new ConflictException(mensajeTerminal(estado, 'descartes'));
    }

    return this.conActorDeAuditoria(actor, async (cliente) => {
      const resultado = await cliente.query<PostulacionFilaCruda>(
        `UPDATE postulaciones
            SET estado = 'descartado', motivo_descarte = $1
          WHERE id = $2 AND estado = 'activa'
          RETURNING ${COLUMNAS_POSTULACION}`,
        [motivo, id],
      );
      const descartada = resultado.rows[0];
      if (descartada === undefined) {
        throw new ConflictException(
          `Conflicto: la postulación cambió mientras se procesaba el descarte; vuelve a intentarlo`,
        );
      }
      // El RETURNING no puede hacer JOIN: el resumen del candidato se toma de
      // la LECTURA inicial (`candidato_id` es inmutable, migración 007).
      return toResponse({
        ...descartada,
        nombres_candidato: fila.nombres_candidato,
        apellidos_candidato: fila.apellidos_candidato,
      });
    });
  }

  // ───────────────────────── historial (audit_log) ─────────────────────────

  /**
   * Historial de cambios de la postulación, leído de `audit_log`.
   *
   * Mismo patrón que `CandidatosService.historial`: `audit_log` lo escribe
   * SOLO el trigger `audit_fila()` (migración 007 en esta tabla); aquí solo se
   * LEE, con el índice `audit_log (table_name, record_id)`. El email del actor
   * se resuelve con un LEFT JOIN a `users` y se devuelve JUNTO AL uuid crudo
   * de `changed_by` (la fuente de verdad).
   *
   * QUÉ SE EXPONE de los jsonb `old_data`/`new_data`: SOLO los 3 campos de
   * negocio (`fase`, `estado`, `motivoDescarte`) — la tabla no tiene PII, así
   * que el motivo de descarte sale tal cual, pero las claves internas (FKs,
   * `created_by`, timestamps) se descartan. El detalle está documentado en
   * `postulaciones.mapper.ts`.
   *
   * Se devuelven las `LIMITE_HISTORIAL` entradas más recientes
   * (`created_at DESC, id DESC`), sin paginación. **404** si la postulación no
   * existe: se comprueba ANTES de leer el log para no devolver un historial
   * vacío ante un id que jamás existió.
   */
  async historial(id: string): Promise<EntradaHistorialPostulacionDto[]> {
    await this.cargarPostulacion(id);

    const filas = await this.database.query<FilaAuditoriaPostulacion>(
      `SELECT a.id::text AS id,
              a.action,
              a.old_data,
              a.new_data,
              a.changed_by,
              u.email AS usuario_email,
              a.created_at
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.changed_by
        WHERE a.table_name = 'postulaciones' AND a.record_id = $1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $2`,
      [id, LIMITE_HISTORIAL],
    );

    return filas.rows.map((fila) => mapearEntradaHistorial(fila));
  }

  // ───────────────────────── helpers privados ─────────────────────────

  /**
   * Resumen del candidato para la respuesta (404 con mensaje claro si no
   * existe). Es la ÚNICA lectura de `candidatos` del módulo y solo pide
   * nombre y apellidos (sin PII sensible).
   */
  private async resumenDelCandidato(
    candidatoId: string,
  ): Promise<{ nombres: string; apellidos: string }> {
    const resultado = await this.database.query<{ nombres: string; apellidos: string }>(
      'SELECT nombres, apellidos FROM candidatos WHERE id = $1',
      [candidatoId],
    );
    const resumen = resultado.rows[0];
    if (resumen === undefined) {
      throw new NotFoundException(`No existe un candidato con id ${candidatoId}`);
    }
    return resumen;
  }

  /**
   * Estado ACTUAL y plazas del requerimiento; 404 con mensaje claro si no
   * existe. Devuelve `numeroPlazas` para los chequeos de cupo (Etapa 9).
   */
  private async datosDelRequerimiento(
    requerimientoId: string,
  ): Promise<{ estado: string; numeroPlazas: number }> {
    const resultado = await this.database.query<{ estado: string; numero_plazas: number }>(
      'SELECT estado, numero_plazas FROM requerimientos WHERE id = $1',
      [requerimientoId],
    );
    const fila = resultado.rows[0];
    if (fila === undefined) {
      throw new NotFoundException(`No existe un requerimiento con id ${requerimientoId}`);
    }
    return { estado: fila.estado, numeroPlazas: fila.numero_plazas };
  }

  /** Contratados ACTUALES del requerimiento (`estado = 'contratado'`). */
  private async contratadosDelRequerimiento(requerimientoId: string): Promise<number> {
    const resultado = await this.database.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM postulaciones
        WHERE requerimiento_id = $1 AND estado = 'contratado'`,
      [requerimientoId],
    );
    return resultado.rows[0]?.total ?? 0;
  }

  /**
   * 409 si el cupo de `numero_plazas` ya está cubierto. Se ejecuta DENTRO de
   * la transacción de `cambiarFase`, tras bloquear la fila del requerimiento
   * (`FOR UPDATE`): dos movimientos simultáneos a la última plaza se
   * SERIALIZAN aquí, y el segundo ve el cupo lleno en vez de pasarlo de largo.
   */
  private async assertCupoDisponible(cliente: PoolClient, requerimientoId: string): Promise<void> {
    const resultado = await cliente.query<{ numero_plazas: number }>(
      `SELECT numero_plazas FROM requerimientos WHERE id = $1 FOR UPDATE`,
      [requerimientoId],
    );
    const numeroPlazas = resultado.rows[0]?.numero_plazas;
    if (numeroPlazas === undefined) {
      // Imposible en la práctica: la postulación tiene FK a este requerimiento.
      throw new NotFoundException(`No existe un requerimiento con id ${requerimientoId}`);
    }
    const contratados = await cliente.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM postulaciones
        WHERE requerimiento_id = $1 AND estado = 'contratado'`,
      [requerimientoId],
    );
    const total = contratados.rows[0]?.total ?? 0;
    if (total >= numeroPlazas) {
      throw new ConflictException(
        `El requerimiento ${requerimientoId} ya cubrió sus ${numeroPlazas} plaza(s): ` +
          `no se pueden mover más candidatos a 'contratacion'`,
      );
    }
  }

  /**
   * Regla 3 (Etapa 9): si las contrataciones CUBREN las plazas, el
   * requerimiento pasa SOLO a `exitoso` («Contrato exitoso») dentro de la MISMA
   * transacción que movió al candidato. El criterio `estado = 'en_proceso'`
   * protege contra un cierre/rechazo simultáneo (affected = 0 y se ignora), y
   * el GUC del actor ya está fijado → el trigger audita QUIÉN movió.
   */
  private async marcarExitosoSiCupoLleno(
    cliente: PoolClient,
    requerimientoId: string,
  ): Promise<void> {
    await cliente.query(
      `UPDATE requerimientos
          SET estado = '${REQUERIMIENTO_EXITOSO}'
        WHERE id = $1
          AND estado = '${REQUERIMIENTO_EN_PROCESO}'
          AND (SELECT count(*) FROM postulaciones
                WHERE requerimiento_id = $1 AND estado = 'contratado') >= numero_plazas`,
      [requerimientoId],
    );
  }

  /** Fila de LECTURA (con resumen del candidato) o 404 con mensaje claro. */
  private async cargarPostulacion(id: string): Promise<PostulacionRow> {
    const resultado = await this.database.query<PostulacionRow>(
      `SELECT ${COLUMNAS_POSTULACION_CON_CANDIDATO}
         FROM postulaciones p
         JOIN candidatos c ON c.id = p.candidato_id
        WHERE p.id = $1`,
      [id],
    );
    const fila = resultado.rows[0];
    if (fila === undefined) {
      throw new NotFoundException(`No existe una postulación con id ${id}`);
    }
    return fila;
  }

  /**
   * INSERT de la fila SIN fase ni estado explícitos: ambos son los DEFAULTS de
   * las columnas (`preseleccion`/`activa`, migración 007), así que la decisión
   * de "toda postulación nace en preseleccion" vive en la BD y no se puede
   * saltar desde la aplicación.
   */
  private async insertarFila(
    cliente: PoolClient,
    candidatoId: string,
    requerimientoId: string,
    createdBy: string,
  ): Promise<PostulacionFilaCruda | undefined> {
    const resultado = await cliente.query<PostulacionFilaCruda>(
      `INSERT INTO postulaciones (candidato_id, requerimiento_id, created_by)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNAS_POSTULACION}`,
      [candidatoId, requerimientoId, createdBy],
    );
    return resultado.rows[0];
  }

  /**
   * Ejecuta `fn` dentro de UNA transacción que fija el GUC
   * `app.current_user_id` con el `sub` del JWT: `audit_fila()` lo usa como
   * QUIÉN ejecuta la escritura (migración 004). `set_config(..., true)` es
   * `SET LOCAL`, así que el valor muere al cerrar la transacción y no contamina
   * al resto del pool. Si `fn` falla → `ROLLBACK` y se PROPAGA el error
   * original (el 23505 llega íntegro al `catch` de `crear`). Réplica del
   * patrón de `ArchivosCvService.conActorDeAuditoria`.
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
