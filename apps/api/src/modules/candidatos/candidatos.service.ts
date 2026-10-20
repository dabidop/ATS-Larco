import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { CryptoService } from '../../common/crypto/crypto.service';
import type { AuthenticatedUser } from '../../common/guards/auth.guard';
import { Candidato } from './candidato.entity';
import { CandidatosStoreService } from './candidatos-store.service';
import type { CandidatoResponseDto, CandidatosPageDto } from './dto/candidato.response';
import type { CreateCandidatoDto } from './dto/create-candidato.dto';
import type { ListCandidatosQueryDto } from './dto/list-candidatos-query.dto';
import type { UpdateCandidatoDto } from './dto/update-candidato.dto';
import { buildCreateData, buildUpdateData, toResponse } from './candidatos.mapper';
import { SearchHashService } from './search-hash.service';

/** Rol con poderes de administración sobre los candidatos (RBAC). */
const ROLE_ADMIN = 'admin_rrhh';

/**
 * Nombres EXACTOS de los índices únicos creados en la migración 005. La capa
 * de servicio los usa para traducir el error 23505 (unique_violation) de
 * PostgreSQL a un 409 con mensaje claro, distinguiendo cédula de email.
 */
const UNIQUE_CEDULA = 'candidatos_cedula_hash_unique';
const UNIQUE_EMAIL = 'candidatos_email_unique';

/** Forma mínima del error de BD que interesa (TypeORM copia `code`/`constraint`). */
interface ErrorConConstraint {
  code?: string;
  constraint?: string;
  driverError?: { code?: string; constraint?: string };
}

/**
 * ¿Es una violación de UNICIDAD de PostgreSQL (23505) sobre la constraint dada?
 *
 * TypeORM lanza `QueryFailedError` y copia `code` y `constraint` del error del
 * driver (`pg`) tanto al propio error como a `driverError`; se comprueban las
 * dos rutas para no depender de una versión concreta.
 */
function esViolacionUnica(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const e = error as ErrorConConstraint;
  const code = e.code ?? e.driverError?.code;
  const nombre = e.constraint ?? e.driverError?.constraint;
  return code === '23505' && nombre === constraint;
}

/**
 * Cifra el teléfono si viene informado; `undefined`, `null` o vacío → `null`.
 * El teléfono es PII opcional: no tiene sentido guardar texto cifrado de un
 * campo sin datos (y el CHECK de BD rechazaría un `''`).
 */
function cifrarTelefono(crypto: CryptoService, telefono: string | undefined): string | null {
  if (telefono === undefined) {
    return null;
  }
  const recortado = telefono.trim();
  return recortado === '' ? null : crypto.encrypt(recortado);
}

/**
 * Escapa los comodines de ILIKE (`%`, `_` y la propia barra invertida) para que
 * el texto del usuario se busque LITERAL y no como patrón. Sin esto, `q='50%'`
 * significaría "termina en 5" y `q='_'` coincidiría con cualquier carácter.
 */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, '\\$&');
}

/**
 * Lógica de CRUD de los candidatos con PII cifrada (Fase 4, parte 1).
 *
 * La persistencia va SIEMPRE por `CandidatosStoreService` (DataSource perezoso).
 * El cifrado lo aporta `CryptoService` (AES-256-CBC) y el hash de búsqueda
 * `SearchHashService` (HMAC-SHA-256 de la cédula normalizada).
 *
 * Invariantes que sostiene aquí (además de los CHECK de la migración 005):
 *  - La cédula NUNCA se guarda en claro: se cifra (`cedula_cifrada`) y se
 *    hashea (`cedula_hash`) antes de escribir.
 *  - Dos candidatos no pueden compartir cédula (único por `cedula_hash`) → 409.
 *  - Dos candidatos no pueden compartir email (único parcial) → 409.
 *  - La respuesta SIEMPRE entrega la PII descifrada y NUNCA el hash interno.
 */
@Injectable()
export class CandidatosService {
  constructor(
    private readonly store: CandidatosStoreService,
    private readonly crypto: CryptoService,
    private readonly searchHash: SearchHashService,
  ) {}

  /**
   * Crea un candidato cifrando su PII y registrando su hash de búsqueda.
   *
   * `createdBy` llega del JWT y no del cuerpo. El INSERT es una sola operación
   * (no necesita transacción): el trigger `audit_fila` (migración 004) atribuye
   * el alta a `created_by` cuando nadie fija el GUC del actor.
   *
   * Duplicados: primero un chequeo previo para responder 409 limpio; el índice
   * único `candidatos_cedula_hash_unique` cierra la carrera si dos peticiones
   * concurrentes crean la misma cédula (el 23505 se traduce aquí abajo).
   */
  async create(dto: CreateCandidatoDto, createdBy: string): Promise<CandidatoResponseDto> {
    const repo = await this.store.repo();

    const cedulaHash = this.searchHash.hashCedula(dto.cedula);
    const existente = await repo.findOneBy({ cedulaHash });
    if (existente !== null) {
      throw new ConflictException('Ya existe un candidato con esa cédula');
    }

    const cedulaCifrada = this.crypto.encrypt(dto.cedula);
    const telefonoCifrada = cifrarTelefono(this.crypto, dto.telefono);

    const entidad = repo.create({
      ...buildCreateData(dto, { cedulaCifrada, telefonoCifrada, cedulaHash }),
      createdBy,
    });

    try {
      const guardada = await repo.save(entidad);
      return toResponse(guardada, this.crypto);
    } catch (error) {
      throw this.mapearDuplicado(error);
    }
  }

  /**
   * Listado paginado ordenado por `created_at DESC`.
   *
   * Dos filtros combinables (AND):
   *  - `q`: búsqueda PARCIAL por ILIKE sobre nombres, apellidos, ciudad y
   *    cargo_actual (los textos NO cifrados, por eso permiten LIKE).
   *  - `cedula`: búsqueda EXACTA; se convierte a `cedula_hash` (HMAC) y se
   *    compara con la columna de hash, SIN descifrar `cedula_cifrada`.
   */
  async list(query: ListCandidatosQueryDto): Promise<CandidatosPageDto> {
    const repo = await this.store.repo();
    const qb = repo.createQueryBuilder('c');

    if (query.q !== undefined) {
      const patron = `%${escaparLike(query.q.trim())}%`;
      qb.andWhere(
        '(c.nombres ILIKE :patron OR c.apellidos ILIKE :patron OR c.ciudad ILIKE :patron OR c.cargoActual ILIKE :patron)',
        { patron },
      );
    }
    if (query.cedula !== undefined) {
      qb.andWhere('c.cedulaHash = :hash', { hash: this.searchHash.hashCedula(query.cedula) });
    }

    qb.orderBy('c.createdAt', 'DESC');
    qb.skip((query.page - 1) * query.limit).take(query.limit);

    const [entidades, total] = await qb.getManyAndCount();
    return {
      items: entidades.map((entidad) => toResponse(entidad, this.crypto)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Detalle por id; 404 con mensaje claro si no existe. Devuelve PII descifrada. */
  async findById(id: string): Promise<CandidatoResponseDto> {
    const repo = await this.store.repo();
    const entidad = await repo.findOneBy({ id });
    if (entidad === null) {
      throw new NotFoundException(`No existe un candidato con id ${id}`);
    }
    return toResponse(entidad, this.crypto);
  }

  /**
   * Actualización parcial.
   *
   * Reglas, en este orden:
   *  1. 404 si el candidato no existe.
   *  2. 403 si no lo creó el usuario actual y no es `admin_rrhh`.
   *  3. 409 si se cambia la cédula por la de OTRO candidato (colisión del hash
   *     de búsqueda; el índice único también lo blindaría).
   *
   * Si el cuerpo trae `cedula`, se RE-CIFRA y se RE-CALCULA su `cedula_hash`.
   * Si trae `telefono`, se re-cifra (vacío → `null`). El resto de campos los
   * aplica `buildUpdateData` (solo los presentes).
   *
   * La escritura va DENTRO de una transacción que fija el GUC
   * `app.current_user_id` con el `sub` del usuario: así `audit_log.changed_by`
   * registra a QUIÉN edita (migración 004), no al `created_by` de la fila.
   */
  async update(
    id: string,
    dto: UpdateCandidatoDto,
    user: AuthenticatedUser,
  ): Promise<CandidatoResponseDto> {
    const repo = await this.store.repo();
    const entidad = await repo.findOneBy({ id });
    if (entidad === null) {
      throw new NotFoundException(`No existe un candidato con id ${id}`);
    }

    if (entidad.createdBy !== user.sub && user.role !== ROLE_ADMIN) {
      throw new ForbiddenException(
        'Solo el creador del candidato o un administrador de RRHH pueden modificarlo',
      );
    }

    const cambios = buildUpdateData(dto);

    // Re-cifrado de la cédula + recalculo del hash de búsqueda (si cambia).
    if (dto.cedula !== undefined) {
      const nuevoHash = this.searchHash.hashCedula(dto.cedula);
      if (nuevoHash !== entidad.cedulaHash) {
        const duplicado = await repo.findOneBy({ cedulaHash: nuevoHash });
        if (duplicado !== null && duplicado.id !== id) {
          throw new ConflictException('Ya existe otro candidato con esa cédula');
        }
        cambios.cedulaHash = nuevoHash;
        cambios.cedulaCifrada = this.crypto.encrypt(dto.cedula);
      }
    }

    // Re-cifrado del teléfono (opcional; vacío → sin teléfono).
    if (dto.telefono !== undefined) {
      cambios.telefonoCifrada = cifrarTelefono(this.crypto, dto.telefono);
    }

    const resultado: Candidato = { ...entidad, ...cambios };

    // Escritura en transacción: fija el GUC del actor ANTES del UPDATE para que
    // `audit_log.changed_by` sea QUIÉN edita y no el `created_by` de la fila.
    return this.store.withTransaction(async (em) => {
      await this.fijarActorDeAuditoria(em, user.sub);
      try {
        await em.save(Candidato, resultado);
      } catch (error) {
        throw this.mapearDuplicado(error);
      }

      // Relectura dentro de la transacción: devuelve el `updated_at` que dejó el
      // trigger `set_updated_at` y los valores ya materializados en BD.
      const actualizada = await em.findOneBy(Candidato, { id });
      if (actualizada === null) {
        throw new ConflictException(`El candidato ${id} dejó de existir tras la actualización`);
      }
      return toResponse(actualizada, this.crypto);
    });
  }

  /**
   * Traduce un error de BD a la excepción HTTP adecuada: una violación de
   * unicidad (23505) sobre cédula o email se convierte en 409 con mensaje
   * claro; cualquier otro error se PROPAGA sin envolver (500 genérico del
   * filtro global).
   */
  private mapearDuplicado(error: unknown): unknown {
    if (esViolacionUnica(error, UNIQUE_CEDULA)) {
      return new ConflictException('Ya existe un candidato con esa cédula');
    }
    if (esViolacionUnica(error, UNIQUE_EMAIL)) {
      return new ConflictException('Ya existe un candidato con ese email');
    }
    return error;
  }

  /**
   * Fija `app.current_user_id` (SET LOCAL, valor parametrizado con `$1`) en la
   * conexión de la transacción EN CURSO: `audit_fila()` lo usa como QUIÉN
   * ejecuta la escritura. `is_local = true` → el GUC se revierte al terminar
   * la transacción, sin contaminar al resto del pool.
   */
  private async fijarActorDeAuditoria(em: EntityManager, sub: string): Promise<void> {
    await em.query(`SELECT set_config('app.current_user_id', $1, true)`, [sub]);
  }
}
