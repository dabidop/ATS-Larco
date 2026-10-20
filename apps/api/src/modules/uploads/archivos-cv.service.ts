import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
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

    const { sha256 } = await this.almacenamiento.guardar(archivo.buffer);
    // Se persiste SIEMPRE el MIME derivado de los magic bytes, no el declarado.
    const mimeType = MIME_POR_TIPO[tipo];

    try {
      const fila = await this.conActorDeAuditoria(createdBy, (cliente) =>
        this.insertarFila(cliente, {
          candidatoId,
          sha256,
          filenameOriginal: archivo.originalname,
          mimeType,
          sizeBytes: archivo.buffer.length,
          createdBy,
        }),
      );
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

    return { archivo: toResponse(fila), contenido: await this.almacenamiento.leer(fila.sha256) };
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
