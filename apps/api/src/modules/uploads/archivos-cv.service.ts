import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../../database/database.service';
import type { ArchivoCvResponseDto, ArchivoCvRow } from './dto/archivo-cv.response';
import { COLUMNAS_PUBLICAS_ARCHIVO, toResponse } from './dto/archivo-cv.response';
import { AlmacenamientoService } from './almacenamiento.service';
import { MIME_POR_TIPO, detectarTipo } from './magic-bytes';

/**
 * Subconjunto de lo que multer entrega en `req.file` que consume este módulo.
 *
 * Se declara aquí —en lugar de usar `Express.Multer.File`— porque `@types/multer`
 * NO está en el array `types` del `tsconfig` de la API (solo `node` y
 * `vitest/globals`) y el paquete `multer` tampoco es dependencia directa de
 * `@ats/api` (llega con `@nestjs/platform-express` y `pnpm` no lo hace
 * resoluble desde el código de la app). Con esta forma estructural el módulo
 * documenta además EXACTAMENTE lo que necesita: el nombre original y los bytes
 * completos en memoria (`memoryStorage`, límite de 5 MB).
 *
 * El `mimetype` que el cliente declara en el multipart se IGNORA a propósito:
 * es información no fiable (ver `detectarTipo`).
 */
export interface ArchivoSubido {
  /** Nombre original en el equipo de quien sube (sin path: `preservePath` off). */
  originalname: string;
  /** Contenido COMPLETO del fichero (≤ 5 MB, límite del interceptor). */
  buffer: Buffer;
}

export interface ResultadoRetencionCv {
  candidatosEvaluados: number;
  filasRetiradas: number;
  blobsRetirados: number;
}

export interface CandidatoReconciliacionCv {
  sha256: string;
  modificadoEn: Date;
}

/** Mensaje de rechazo cuando los magic bytes no corresponden a un CV permitido. */
const MENSAJE_TIPO_NO_PERMITIDO = 'Tipo de archivo no permitido. Se aceptan PDF, DOC, DOCX y RTF.';

/** Nombre EXACTO del índice único creado en la migración 006. */
const UNIQUE_CANDIDATO_SHA = 'archivos_cv_candidato_sha256_unique';

/** Forma mínima del error de BD que interesa (pg copia `code`/`constraint`). */
interface ErrorConConstraint {
  code?: string;
  constraint?: string;
}

/**
 * ¿Es una violación de UNICIDAD (23505) de PostgreSQL sobre la constraint dada?
 * `node-postgres` copia los campos del ErrorResponse sobre el `Error`, así que
 * `code` y `constraint` están en el propio objeto.
 */
function esViolacionUnica(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const e = error as ErrorConConstraint;
  return e.code === '23505' && e.constraint === constraint;
}

/**
 * Casos de uso de los archivos de CV de un candidato (Fase 4, parte 2).
 *
 * Persistencia con el pool `pg` GLOBAL (`DatabaseService`), igual que `auth` o
 * `health`, y NO con TypeORM: `archivos_cv` es una tabla autocontenida y este
 * módulo así no necesita DataSource propio ni crear un ciclo de módulos con
 * `CandidatosModule` (él importa ESTE módulo, no al revés).
 *
 * Invariantes que sostiene (además de los CHECK y el índice único de la 006):
 *  - El tipo de archivo se decide por MAGIC BYTES, jamás por la extensión ni
 *    por el `Content-Type` del cliente → 400 si no es PDF/DOC/DOCX/RTF.
 *  - El contenido se guarda en disco con dedup por hash; la fila referencia el
 *    hash, nunca una ruta.
 *  - Mismo candidato + mismo contenido → 409 (índice único, carrera incluida).
 *  - El `sha256` de la fila SIEMPRE coincide con el fichero en disco; si no
 *    está (borrado externo), la descarga responde 500 «Archivo corrupto en
 *    almacenamiento»: es inconsistencia del SERVIDOR, no culpa del cliente.
 *
 * AUDITORÍA: la escritura va dentro de una transacción que fija el GUC
 * `app.current_user_id` con el `sub` del JWT (migración 004), igual que el
 * resto de módulos, para que `audit_log.changed_by` sea QUIÉN sube el archivo.
 */
@Injectable()
export class ArchivosCvService {
  constructor(
    private readonly database: DatabaseService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  /**
   * Adjunta un CV a un candidato → metadatos con `201`.
   *
   * Orden y fallos:
   *  1. 404 si el candidato no existe (se comprueba ANTES de tocar el disco).
   *  2. 400 si los magic bytes no son PDF/DOC/DOCX/RTF.
   *  3. Escritura en disco con dedup (idempotente: si el candidato ya tenía el
   *     archivo, el fichero ya estaba y no se reescribe).
   *  4. INSERT de la fila; 409 si `(candidato_id, sha256)` ya existía. El disco
   *     no queda con huérfanos: el fichero es compartido con la fila previa.
   */
  async subir(
    candidatoId: string,
    archivo: ArchivoSubido,
    createdBy: string,
  ): Promise<ArchivoCvResponseDto> {
    await this.verificarQueExisteElCandidato(candidatoId);

    const tipo = detectarTipo(archivo.buffer);
    if (tipo === null) {
      throw new BadRequestException(MENSAJE_TIPO_NO_PERMITIDO);
    }

    // El advisory lock vive en la misma sesión/transacción que el INSERT y
    // coordina esta publicación con la retención en cualquier proceso.
    try {
      const fila = await this.conActorDeAuditoria(createdBy, async (cliente) => {
        const { sha256 } = await this.guardarConBloqueo(cliente, archivo.buffer);
        // Se persiste SIEMPRE el MIME derivado de los magic bytes.
        const mimeType = MIME_POR_TIPO[tipo];
        return this.insertarFila(cliente, {
          candidatoId,
          sha256,
          filenameOriginal: archivo.originalname,
          mimeType,
          sizeBytes: archivo.buffer.length,
          createdBy,
        });
      });
      if (fila === undefined) {
        // Imposible en la práctica: un INSERT con RETURNING siempre devuelve fila.
        throw new Error('El INSERT sobre archivos_cv no devolvió ninguna fila');
      }
      return toResponse(fila);
    } catch (error) {
      if (esViolacionUnica(error, UNIQUE_CANDIDATO_SHA)) {
        throw new ConflictException('El archivo ya está adjunto a este candidato');
      }
      throw error;
    }
  }

  /**
   * Adjunta un CV usando una transacción PG que ya abrió el caso de uso padre.
   * El fichero se escribe antes del INSERT: si la BD revierte, puede quedar un
   * blob huérfano, pero nunca una fila que apunte a un fichero inexistente.
   * Tampoco se borra el blob en caso de error: puede estar compartido.
   */
  async subirEnTransaccion(
    cliente: PoolClient,
    candidatoId: string,
    archivo: ArchivoSubido,
    createdBy: string,
  ): Promise<ArchivoCvResponseDto> {
    const candidato = await cliente.query('SELECT 1 FROM candidatos WHERE id = $1', [candidatoId]);
    if (candidato.rowCount === 0) {
      throw new NotFoundException(`No existe un candidato con id ${candidatoId}`);
    }

    const tipo = detectarTipo(archivo.buffer);
    if (tipo === null) {
      throw new BadRequestException(MENSAJE_TIPO_NO_PERMITIDO);
    }

    try {
      await cliente.query(`SELECT set_config('app.current_user_id', $1, true)`, [createdBy]);
      const { sha256 } = await this.guardarConBloqueo(cliente, archivo.buffer);
      const fila = await this.insertarFila(cliente, {
        candidatoId,
        sha256,
        filenameOriginal: archivo.originalname,
        mimeType: MIME_POR_TIPO[tipo],
        sizeBytes: archivo.buffer.length,
        createdBy,
      });
      if (fila === undefined) {
        throw new Error('El INSERT sobre archivos_cv no devolvió ninguna fila');
      }
      return toResponse(fila);
    } catch (error) {
      if (esViolacionUnica(error, UNIQUE_CANDIDATO_SHA)) {
        throw new ConflictException('El archivo ya está adjunto a este candidato');
      }
      throw error;
    }
  }

  /** Metadatos de TODOS los archivos del candidato (más recientes primero). */
  async listar(candidatoId: string): Promise<ArchivoCvResponseDto[]> {
    await this.verificarQueExisteElCandidato(candidatoId);

    const resultado = await this.database.query<ArchivoCvRow>(
      `SELECT ${COLUMNAS_PUBLICAS_ARCHIVO}
         FROM archivos_cv
        WHERE candidato_id = $1
        ORDER BY created_at DESC, id ASC`,
      [candidatoId],
    );
    return resultado.rows.map((fila) => toResponse(fila));
  }

  /**
   * Bytes de un archivo para descargarlo, validando que pertenezca al
   * candidato de la RUTA (404 si no) y que siga en disco (500 si no).
   *
   * La cabecera HTTP (tipo real y nombre original) la monta el controlador con
   * los datos que vuelven aquí: este servicio no conoce HTTP.
   */
  async descargar(
    candidatoId: string,
    archivoId: string,
  ): Promise<{ archivo: ArchivoCvResponseDto; contenido: Buffer }> {
    // Si el candidato no existe, la FK impide que la fila exista: la misma
    // consulta (id + candidato_id) responde 404 en ambos casos.
    const resultado = await this.database.query<ArchivoCvRow>(
      `SELECT ${COLUMNAS_PUBLICAS_ARCHIVO}
         FROM archivos_cv
        WHERE id = $1 AND candidato_id = $2`,
      [archivoId, candidatoId],
    );

    const fila = resultado.rows[0];
    if (fila === undefined) {
      throw new NotFoundException(
        `No existe el archivo ${archivoId} en el candidato ${candidatoId}`,
      );
    }

    if (!(await this.almacenamiento.existe(fila.sha256))) {
      // La fila dice que el archivo existe y en disco no está: es una
      // inconsistencia NUESTRA (no del cliente), por eso 500 y no 404.
      throw new InternalServerErrorException('Archivo corrupto en almacenamiento');
    }

    const contenido = await this.almacenamiento.leer(fila.sha256);
    const sha256Real = createHash('sha256').update(contenido).digest('hex');
    if (sha256Real !== fila.sha256) {
      throw new InternalServerErrorException('Archivo corrupto en almacenamiento');
    }

    return { archivo: toResponse(fila), contenido };
  }

  /**
   * Retira CVs de candidatos cuyas postulaciones están todas descartadas y
   * cuyo descarte más reciente supera la retención indicada. Los contratados
   * y cualquier candidato con una postulación activa quedan fuera.
   *
   * La BD se limpia primero en una transacción. Después se eliminan solo los
   * blobs sin referencias restantes; si el disco falla, queda un huérfano
   * seguro para reintento, nunca una fila apuntando a un fichero inexistente.
   * Este método es mantenimiento explícito, no un endpoint HTTP.
   */
  async retirarCvDescartadosAntesDe(fechaLimite: Date): Promise<ResultadoRetencionCv> {
    const cliente = await this.database.pool.connect();
    const hashesBloqueados: string[] = [];
    try {
      await cliente.query('BEGIN');
      const candidatos = await cliente.query<{ candidato_id: string }>(
        `SELECT p.candidato_id
           FROM postulaciones p
          GROUP BY p.candidato_id
         HAVING bool_and(p.estado = 'descartado')
            AND max(p.updated_at) <= $1`,
        [fechaLimite],
      );
      const ids = candidatos.rows.map((fila) => fila.candidato_id);
      if (ids.length === 0) {
        await cliente.query('COMMIT');
        return { candidatosEvaluados: 0, filasRetiradas: 0, blobsRetirados: 0 };
      }

      const hashes = await cliente.query<{ sha256: string }>(
        'SELECT DISTINCT sha256 FROM archivos_cv WHERE candidato_id = ANY($1::uuid[]) ORDER BY sha256',
        [ids],
      );
      for (const { sha256 } of hashes.rows) {
        await this.adquirirBloqueo(cliente, sha256);
        hashesBloqueados.push(sha256);
      }

      const borradas = await cliente.query<{ sha256: string }>(
        `DELETE FROM archivos_cv
          WHERE candidato_id = ANY($1::uuid[])
        RETURNING sha256`,
        [ids],
      );
      await cliente.query('COMMIT');
      let blobsRetirados = 0;
      for (const sha256 of hashesBloqueados) {
        const referencia = await cliente.query(
          'SELECT 1 FROM archivos_cv WHERE sha256 = $1 LIMIT 1',
          [sha256],
        );
        if ((referencia.rowCount ?? 0) === 0 && (await this.almacenamiento.retirar(sha256))) {
          blobsRetirados += 1;
        }
      }
      return {
        candidatosEvaluados: ids.length,
        filasRetiradas: borradas.rowCount ?? 0,
        blobsRetirados,
      };
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      for (const sha256 of hashesBloqueados.reverse()) {
        await this.liberarBloqueo(cliente, sha256).catch(() => undefined);
      }
      cliente.release();
    }
  }

  /**
   * Devuelve candidatos a reconciliación, pero deliberadamente NO elimina.
   * La antigüedad/gracia debe revisarse y aprobarse por operación antes de
   * invocar una futura herramienta de mantenimiento.
   */
  async planificarReconciliacionHuerfanos(
    noModificadoDespuesDe: Date,
  ): Promise<CandidatoReconciliacionCv[]> {
    const blobs = (await this.almacenamiento.listarBlobs()).filter(
      (blob) => blob.modificadoEn <= noModificadoDespuesDe,
    );
    if (blobs.length === 0) return [];
    const referencias = await this.database.query<{ sha256: string }>(
      'SELECT DISTINCT sha256 FROM archivos_cv WHERE sha256 = ANY($1::text[])',
      [blobs.map((blob) => blob.sha256)],
    );
    const referenciados = new Set(referencias.rows.map((fila) => fila.sha256));
    return blobs.filter((blob) => !referenciados.has(blob.sha256));
  }

  /** 404 con mensaje claro si el candidato no existe. */
  private async verificarQueExisteElCandidato(candidatoId: string): Promise<void> {
    const resultado = await this.database.query('SELECT 1 FROM candidatos WHERE id = $1', [
      candidatoId,
    ]);
    if (resultado.rowCount === 0) {
      throw new NotFoundException(`No existe un candidato con id ${candidatoId}`);
    }
  }

  private async guardarConBloqueo(cliente: PoolClient, buffer: Buffer) {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    // El lock transaccional se libera automáticamente al COMMIT/ROLLBACK.
    await cliente.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [sha256]);
    return this.almacenamiento.guardar(buffer);
  }

  private async adquirirBloqueo(cliente: PoolClient, sha256: string): Promise<void> {
    await cliente.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [sha256]);
  }

  private async liberarBloqueo(cliente: PoolClient, sha256: string): Promise<void> {
    await cliente.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [sha256]);
  }

  /** INSERT de la fila; devuelve la fila materializada en BD (con `RETURNING`). */
  private async insertarFila(
    cliente: PoolClient,
    datos: {
      candidatoId: string;
      sha256: string;
      filenameOriginal: string;
      mimeType: string;
      sizeBytes: number;
      createdBy: string;
    },
  ): Promise<ArchivoCvRow | undefined> {
    const resultado = await cliente.query<ArchivoCvRow>(
      `INSERT INTO archivos_cv (candidato_id, sha256, filename_original, mime_type, size_bytes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNAS_PUBLICAS_ARCHIVO}`,
      [
        datos.candidatoId,
        datos.sha256,
        datos.filenameOriginal,
        datos.mimeType,
        datos.sizeBytes,
        datos.createdBy,
      ],
    );
    return resultado.rows[0];
  }

  /**
   * Ejecuta `fn` dentro de UNA transacción que fija el GUC
   * `app.current_user_id` con el `sub` del JWT: `audit_fila()` lo usa como
   * QUIÉN ejecuta la escritura (migración 004). `set_config(..., true)` es
   * `SET LOCAL`, así que el valor muere al cerrar la transacción y no contamina
   * al resto del pool. Si `fn` falla → `ROLLBACK` y se PROPAGA el error original
   * (el 23505 llega íntegro al `catch` de `subir`).
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
