import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';

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
 * Heredero directo de `admin_rrhh` (migración 008, Etapa 8B): el
 * `superusuario` (IT) edita candidatos ajenos con el MISMO poder que RRHH.
 */
const ROLE_SUPERUSUARIO = 'superusuario';

/** ¿`role` administra los candidatos (RRHH o su heredero IT)? */
function esRolAdministrador(role: string): boolean {
  return role === ROLE_ADMIN || role === ROLE_SUPERUSUARIO;
}

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

// ───────────────────────── historial de auditoría (Fase 4, parte 3) ─────────────────────────

/**
 * Límite de entradas de `GET /api/candidatos/:id/historial`: las 200 más
 * recientes (`created_at DESC`). Sin paginación a propósito —es una vista de
 * CONSULTA, no de gestión—; el historial completo e íntegro sigue vivo en
 * `audit_log` (tabla inmutable) por si un cliente necesita más atrás.
 */
const LIMITE_HISTORIAL = 200;

/** Máscara que sustituye a la PII cifrada en el historial (jamás se descifra). */
const PII_ENMASCARADA = '***';

/**
 * Acciones que el CHECK `audit_log_action_check` admite. Sobre `candidatos` el
 * trigger `audit_fila()` (migraciones 003/004) SOLO emite INSERT y UPDATE —no
 * hay trigger de borrado—; DELETE queda tipado por completitud y hoy es
 * inalcanzable para esta tabla.
 */
export type AccionHistorial = 'INSERT' | 'UPDATE' | 'DELETE';

/** Snapshot de `old_data`/`new_data` (jsonb) tal y como la entrega `pg`. */
export type DatosAuditoria = Record<string, unknown> | null;

/** Un campo concreto del historial (cambio del diff o alta/borrado completo). */
export interface CambioHistorialDto {
  /** Nombre PÚBLICO del campo (camelCase, como habla la API). */
  campo: string;
  /** Valor anterior; `null` en el alta. La PII sale enmascarada. */
  antes: unknown;
  /** Valor posterior; `null` en un borrado. La PII sale enmascarada. */
  despues: unknown;
}

/** Entrada del historial tal y como sale por `GET /api/candidatos/:id/historial`. */
export interface EntradaHistorialDto {
  /**
   * `audit_log.id` (bigserial) devuelto como TEXTO: `pg` entrega `int8` así
   * para no perder precisión en enteros mayores que 2^53.
   */
  id: string;
  accion: AccionHistorial;
  /** `created_at` en ISO 8601. */
  fecha: string;
  /** `changed_by`: uuid crudo del actor (fuente de verdad) o `null`. */
  usuario: string | null;
  /** Email del actor (LEFT JOIN a `users`, por PK); `null` si ya no existe. */
  usuarioEmail: string | null;
  campos: CambioHistorialDto[];
}

/**
 * Fila cruda de `audit_log` que devuelve el SQL del servicio (el email ya
 * viene resuelto de `users`).
 */
export interface FilaAuditoriaCruda {
  id: string;
  action: string;
  old_data: DatosAuditoria;
  new_data: DatosAuditoria;
  changed_by: string | null;
  usuario_email: string | null;
  created_at: Date | string;
}

/**
 * Whitelist de columnas PÚBLICAS del historial: el jsonb de `audit_log` guarda
 * los datos COMO SE LLAMAN EN BD (snake_case) y aquí se traducen al camelCase
 * de la API (mismo criterio de puente explícito que `candidatos.mapper.ts`).
 *
 *  - `cedula_hash` se OMITE: no es dato de usuario, es el HMAC interno de
 *    búsqueda, y filtrar por diff no debe exponerlo jamás.
 *  - Cualquier columna DESCONOCIDA también se DESCARTA (fail-safe): si mañana
 *    aparece una columna nueva en `candidatos` —posiblemente PII— no se
 *    expone hasta que se decida aquí cómo presentarla.
 */
const COLUMNAS_HISTORIAL: Readonly<Record<string, string>> = {
  nombres: 'nombres',
  apellidos: 'apellidos',
  email: 'email',
  cedula_cifrada: 'cedula',
  telefono_cifrada: 'telefono',
  ciudad: 'ciudad',
  departamento_id: 'departamentoId',
  cargo_actual: 'cargoActual',
  expectativa_salarial: 'expectativaSalarial',
  disponibilidad: 'disponibilidad',
  notas: 'notas',
};

/** Columnas PII cuyo valor se MASCARA (audit_log solo guarda su cifrado `v1:...`). */
const COLUMNAS_PII = new Set(['cedula_cifrada', 'telefono_cifrada']);

/**
 * Sustituye un valor PII por `'***'`: el historial NUNCA descifra ni expone el
 * cifrado `v1:...` (ni el claro, que no está). El `null` se conserva: no es
 * PII y sí informa ("no tenía teléfono").
 */
function enmascararPII(valor: unknown): unknown {
  return valor === null || valor === undefined ? null : PII_ENMASCARADA;
}

/** Valor de `columna` en una snapshot jsonb, normalizado a `null`. */
function valorDe(datos: DatosAuditoria, columna: string): unknown {
  return datos?.[columna] ?? null;
}

/** Valor listo para la respuesta: PII enmascarada, el resto tal cual. */
function valorPublico(columna: string, valor: unknown): unknown {
  return COLUMNAS_PII.has(columna) ? enmascararPII(valor) : valor;
}

/**
 * Campos de un ALTA: las columnas públicas con valor de `new_data`, con
 * `antes: null`. Los campos vacíos (`null`) se omiten: en un alta solo
 * informan los datos dados de alta.
 */
function camposDeAlta(nuevos: DatosAuditoria): CambioHistorialDto[] {
  const campos: CambioHistorialDto[] = [];
  for (const [columna, campo] of Object.entries(COLUMNAS_HISTORIAL)) {
    const valor = valorDe(nuevos, columna);
    if (valor !== null) {
      campos.push({ campo, antes: null, despues: valorPublico(columna, valor) });
    }
  }
  return campos;
}

/** Campos de un BORRADO (inalcanzable hoy en `candidatos`): `despues: null`. */
function camposDeBorrado(antiguos: DatosAuditoria): CambioHistorialDto[] {
  const campos: CambioHistorialDto[] = [];
  for (const [columna, campo] of Object.entries(COLUMNAS_HISTORIAL)) {
    const valor = valorDe(antiguos, columna);
    if (valor !== null) {
      campos.push({ campo, antes: valorPublico(columna, valor), despues: null });
    }
  }
  return campos;
}

/**
 * Campos que CAMBIARON entre dos snapshots jsonb de `audit_log` (`old_data` y
 * `new_data`), en el orden del whitelist. Los valores SIN cambios no aparecen;
 * la PII se COMPARA por su cifrado pero se PUBLICA enmascarada (función PURA:
 * se testea sin BD).
 */
export function calcularCambiosHistorial(
  antes: DatosAuditoria,
  despues: DatosAuditoria,
): CambioHistorialDto[] {
  const cambios: CambioHistorialDto[] = [];
  for (const [columna, campo] of Object.entries(COLUMNAS_HISTORIAL)) {
    const valorAntes = valorDe(antes, columna);
    const valorDespues = valorDe(despues, columna);
    if (Object.is(valorAntes, valorDespues)) {
      continue;
    }
    cambios.push({
      campo,
      antes: valorPublico(columna, valorAntes),
      despues: valorPublico(columna, valorDespues),
    });
  }
  return cambios;
}

/** `timestamptz` de `pg` (Date) o texto → ISO 8601 estricto. */
function aIso8601(fecha: Date | string): string {
  return fecha instanceof Date ? fecha.toISOString() : new Date(fecha).toISOString();
}

/**
 * Fila cruda de `audit_log` → entrada pública del historial (función PURA).
 *
 * Cualquier `action` inesperada (imposible: el CHECK la acota a las tres
 * arriba) se trata como UPDATE para degradar sin PERDER la entrada.
 */
export function mapearEntradaHistorial(fila: FilaAuditoriaCruda): EntradaHistorialDto {
  const accion: AccionHistorial =
    fila.action === 'INSERT' ? 'INSERT' : fila.action === 'DELETE' ? 'DELETE' : 'UPDATE';

  const campos =
    accion === 'INSERT'
      ? camposDeAlta(fila.new_data)
      : accion === 'DELETE'
        ? camposDeBorrado(fila.old_data)
        : calcularCambiosHistorial(fila.old_data, fila.new_data);

  return {
    id: fila.id,
    accion,
    fecha: aIso8601(fila.created_at),
    usuario: fila.changed_by,
    usuarioEmail: fila.usuario_email,
    campos,
  };
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
 *
 * El HISTORIAL de cambios (Fase 4, parte 3) se lee de `audit_log` vía
 * `historial(id)`: solo lectura, PII SIEMPRE enmascarada (nunca se descifra),
 * con la lógica de diff/mask en funciones puras exportadas
 * (`calcularCambiosHistorial`, `mapearEntradaHistorial`) que se testean sin BD.
 */
@Injectable()
export class CandidatosService {
  constructor(
    private readonly store: CandidatosStoreService,
    private readonly crypto: CryptoService,
    private readonly searchHash: SearchHashService,
  ) {}

  /**
   * 404 si `departamentoId` viene informado y NO existe (Etapa 9): el cuerpo
   * nunca debe provocar un 500 de FK violada. Ausente o `null` no comprueban
   * (desasociar el departamento siempre es válido).
   */
  private async assertDepartamentoExiste(
    repo: Repository<Candidato>,
    departamentoId: string | null | undefined,
  ): Promise<void> {
    if (departamentoId === undefined || departamentoId === null) {
      return;
    }
    const filas = await repo.manager.query<unknown[]>('SELECT 1 FROM departamentos WHERE id = $1', [
      departamentoId,
    ]);
    if (filas.length === 0) {
      throw new NotFoundException(`No existe un departamento con id ${departamentoId}`);
    }
  }

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

    await this.assertDepartamentoExiste(repo, dto.departamentoId);

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
    if (query.departamentoId !== undefined) {
      qb.andWhere('c.departamentoId = :departamentoId', {
        departamentoId: query.departamentoId,
      });
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
   *  2. 403 si no lo creó el usuario actual y no es `admin_rrhh` ni
   *     `superusuario`.
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

    // `admin_rrhh` y su heredero `superusuario` (Etapa 8B) editan cualquier
    // fila; el resto solo lo que creó.
    if (entidad.createdBy !== user.sub && !esRolAdministrador(user.role)) {
      throw new ForbiddenException(
        'Solo el creador del candidato o un administrador de RRHH pueden modificarlo',
      );
    }

    const cambios = buildUpdateData(dto);
    if (dto.departamentoId !== undefined) {
      await this.assertDepartamentoExiste(repo, dto.departamentoId);
    }

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

  // ───────────────────────── historial (Fase 4, parte 3) ─────────────────────────

  /**
   * Historial de cambios del candidato, leído de `audit_log` (Fase 4, parte 3).
   *
   * `audit_log` lo escribe SOLO el trigger `audit_fila()` (migraciones
   * 003/004): este método no INSERTA nada, solo LEE. La consulta va por SQL
   * crudo (sin entidad TypeORM: no aporta una entity a una tabla de solo
   * lectura) usando el store LAZY del módulo y el índice
   * `audit_log (table_name, record_id)`. El email del actor se resuelve con un
   * LEFT JOIN a `users` (búsqueda por PK: barata) y se devuelve JUNTO AL uuid
   * crudo de `changed_by`: el uuid es la fuente de verdad (sobrevive a cambios
   * de email y a usuarios borrados) y el email aporta legibilidad al cliente.
   *
   * PII: el historial NUNCA descifra. `cedula`/`telefono` aparecen como
   * `'***'` (`mapearEntradaHistorial` los enmascara) y `cedula_hash` ni se
   * lista. Se devuelven las `LIMITE_HISTORIAL` entradas más recientes
   * (`created_at DESC, id DESC`), sin paginación.
   *
   * 404 si el candidato no existe: se comprueba ANTES de leer el log para no
   * devolver un historial vacío ante un id que jamás existió.
   */
  async historial(id: string): Promise<EntradaHistorialDto[]> {
    const repo = await this.store.repo();

    const candidato = await repo.findOneBy({ id });
    if (candidato === null) {
      throw new NotFoundException(`No existe un candidato con id ${id}`);
    }

    const filas = (await repo.query(
      `SELECT a.id::text AS id,
              a.action,
              a.old_data,
              a.new_data,
              a.changed_by,
              u.email AS usuario_email,
              a.created_at
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.changed_by
        WHERE a.table_name = 'candidatos' AND a.record_id = $1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $2`,
      [id, LIMITE_HISTORIAL],
    )) as FilaAuditoriaCruda[];

    return filas.map((fila) => mapearEntradaHistorial(fila));
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
