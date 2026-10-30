import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';

import { hashPassword } from '../../common/crypto/password.util';
import { DatabaseService } from '../../database/database.service';
import type { CreateUsuarioDto } from './dto/create-usuario.dto';
import type { ListUsuariosQueryDto } from './dto/list-usuarios-query.dto';
import type { UpdateUsuarioDto } from './dto/update-usuario.dto';
import {
  COLUMNAS_USUARIO,
  toUsuarioResponse,
  type UsuarioFila,
  type UsuarioResponseDto,
  type UsuariosPageDto,
} from './dto/usuario.response';

/** Nombre EXACTO de la constraint única de `users.email` (migración 001). */
const UNIQUE_EMAIL = 'users_email_key';

/** Código del 4.º rol (migración 008): el que gestiona usuarios. */
const ROL_SUPERUSUARIO = 'superusuario';

/** Mensajes de negocio compartidos por servicio y tests. */
const MENSAJE_DUPLICADO = 'Ya existe un usuario con ese correo';
const MENSAJE_SIN_CAMBIOS = 'Debe indicar al menos un cambio (activo, rol, password o jefatura)';
const MENSAJE_DESACTIVARSE = 'No puede desactivar su propia cuenta';
const MENSAJE_CAMBIAR_ROL_PROPIO = 'No puede cambiar su propio rol';
const MENSAJE_ULTIMO_SUPERUSUARIO = 'Debe permanecer al menos un superusuario activo';

/** `FROM` común a todas las lecturas: la respuesta SIEMPRE necesita `roles`. */
const FROM_USUARIOS = 'FROM users u JOIN roles r ON r.id = u.role_id';

/** Forma mínima del error de BD que interesa (pg copia `code`/`constraint`). */
interface ErrorConConstraint {
  code?: string;
  constraint?: string;
}

/**
 * ¿Es una violación de UNICIDAD (23505) de PostgreSQL sobre la constraint dada?
 * `node-postgres` copia los campos del ErrorResponse sobre el `Error`, así que
 * `code` y `constraint` están en el propio objeto (mismo patrón que
 * `PostulacionesService.esViolacionUnica`).
 */
function esViolacionUnica(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const e = error as ErrorConConstraint;
  return e.code === '23505' && e.constraint === constraint;
}

/**
 * Escapa los comodines de ILIKE (`%`, `_` y la propia barra invertida) para que
 * el texto del usuario se busque LITERAL y no como patrón (mismo criterio que
 * `CandidatosService.escaparLike`).
 */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, '\\$&');
}

/**
 * Jefatura del líder (corrección posterior a la Etapa 9) normalizada:
 *  - `undefined` → SIN CAMBIO (campo ausente en el cuerpo);
 *  - `null` o `''` → `NULL` (área vacía: el líder queda con el fallback);
 *  - cualquier texto → `trim()`; si tras el trim no queda nada, `NULL`.
 */
function normalizarJefatura(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) {
    return undefined;
  }
  if (valor === null) {
    return null;
  }
  const texto = valor.trim();
  return texto.length === 0 ? null : texto;
}

/**
 * Casos de uso de los usuarios de la aplicación (Etapa 8B).
 *
 * Módulo EXCLUSIVO del `superusuario` (IT, migración 008): RRHH NO gestiona
 * cuentas. El `superusuario` además hereda todo el poder de `admin_rrhh` sobre
 * el negocio, pero ese poder vive en los OTROS módulos — aquí solo se gestionan
 * cuentas: alta, listado, detalle, baja/reactivación, rol y contraseña.
 *
 * Persistencia con el pool `pg` GLOBAL (`DatabaseService`) y NO con TypeORM
 * (mismo patrón que `embudo`/`uploads`): `users` y `roles` son tablas
 * autocontenidas de la migración 001 y este módulo solo necesita SQL crudo.
 *
 * Invariantes que sostiene (además del UNIQUE de `users.email`):
 *  - El `password_hash` NUNCA sale por la API: los SELECT piden columnas
 *    EXPLÍCITAS (`COLUMNAS_USUARIO`) y jamás `*`.
 *  - Dos cuentas no comparten email (chequeo previo + 23505 en la carrera) → 409.
 *  - Ninguna cuenta se desactiva a sí misma ni cambia su propio rol → 409.
 *  - SIEMPRE queda al menos UN `superusuario` activo → 409 (si no, nadie podría
 *    volver a entrar a gestionar usuarios).
 *
 * AUDITORÍA: cada escritura va dentro de una transacción que fija el GUC
 * `app.current_user_id` con el `sub` del JWT (patrón EXACTO de
 * `PostulacionesService.conActorDeAuditoria`), de modo que el trigger
 * `users_audit_log` → `audit_fila()` registra a QUIÉN crea o modifica la
 * cuenta en `audit_log.changed_by`, y no al autor de la fila.
 */
@Injectable()
export class UsuariosService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Listado paginado ordenado por `created_at DESC`, con filtros combinables
   * (AND): `q` (ILIKE sobre nombre y email) y `rol` (código exacto). El total
   * se cuenta con el MISMO `WHERE`, así que `total` es siempre el de la página
   * completa y no el de la página servida.
   */
  async listar(query: ListUsuariosQueryDto): Promise<UsuariosPageDto> {
    const condiciones: string[] = [];
    const params: unknown[] = [];

    if (query.q !== undefined) {
      params.push(`%${escaparLike(query.q.trim())}%`);
      condiciones.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }
    if (query.rol !== undefined) {
      params.push(query.rol);
      condiciones.push(`r.code = $${params.length}`);
    }

    const where = condiciones.length === 0 ? '' : `WHERE ${condiciones.join(' AND ')}`;

    const conteo = await this.database.query<{ total: number }>(
      `SELECT count(*)::int AS total ${FROM_USUARIOS} ${where}`,
      params,
    );

    // `id ASC` como desempate: dos filas con el MISMO created_at mantienen un
    // orden estable y determinista entre páginas (mismo criterio que `embudo`).
    const filas = await this.database.query<UsuarioFila>(
      `SELECT ${COLUMNAS_USUARIO}
         ${FROM_USUARIOS}
        ${where}
        ORDER BY u.created_at DESC, u.id ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );

    return {
      items: filas.rows.map((fila) => toUsuarioResponse(fila)),
      total: conteo.rows[0]?.total ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Crea un usuario → **201** (activo, con `password` hasheado con scrypt y
   * `email` normalizado a minúsculas).
   *
   * Orden y fallos (en este ORDEN, a propósito):
   *  1. **409** si ya existe una cuenta con ese email (chequeo previo con
   *     `LOWER(email)` para responder limpio, insensible a mayúsculas).
   *  2. **400** si el rol no existe en `roles` (imposible si el DTO validó la
   *     lista, salvo una BD sin la migración 008: mejor 400 que un 500 de FK).
   *  3. Hash de la contraseña FUERA de la transacción (scrypt es lento: no se
   *     mantiene abierto un socket del pool mientras se calcula).
   *  4. INSERT dentro de la transacción con el GUC del actor; la relectura con
   *     JOIN devuelve la forma pública COMPLETA (el RETURNING no puede hacer
   *     JOIN). Carrera entre dos altas simultáneas del mismo email → el índice
   *     único `users_email_key` responde 23505, traducido aquí al MISMO 409.
   */
  async crear(dto: CreateUsuarioDto, actor: string): Promise<UsuarioResponseDto> {
    const email = dto.email.trim().toLowerCase();

    const existente = await this.database.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [
      email,
    ]);
    if ((existente.rowCount ?? 0) > 0) {
      throw new ConflictException(MENSAJE_DUPLICADO);
    }

    const rol = await this.database.query<{ id: string }>('SELECT id FROM roles WHERE code = $1', [
      dto.rol,
    ]);
    const rolId = rol.rows[0]?.id;
    if (rolId === undefined) {
      throw new BadRequestException(`No existe el rol '${dto.rol}' en el sistema`);
    }

    const passwordHash = await hashPassword(dto.password);
    const jefatura = normalizarJefatura(dto.jefatura) ?? null;

    try {
      return await this.conActorDeAuditoria(actor, async (cliente) => {
        const insertado = await cliente.query<{ id: string }>(
          `INSERT INTO users (role_id, email, password_hash, full_name, active, jefatura)
           VALUES ($1, $2, $3, $4, true, $5)
           RETURNING id`,
          [rolId, email, passwordHash, dto.nombre, jefatura],
        );
        const id = insertado.rows[0]?.id;
        if (id === undefined) {
          // Imposible en la práctica: un INSERT con RETURNING siempre devuelve fila.
          throw new Error('El INSERT sobre users no devolvió ninguna fila');
        }
        return toUsuarioResponse(await this.cargarUsuarioCon(cliente, id));
      });
    } catch (error) {
      if (esViolacionUnica(error, UNIQUE_EMAIL)) {
        throw new ConflictException(MENSAJE_DUPLICADO);
      }
      throw error;
    }
  }

  /** Detalle por id; 404 con mensaje claro si no existe. Jamás expone el hash. */
  async findById(id: string): Promise<UsuarioResponseDto> {
    return toUsuarioResponse(await this.cargarUsuario(id));
  }

  /**
   * Actualización parcial → **200** con la fila ACTUALIZADA.
   *
   * Reglas, en este orden (todas verificadas por `test/usuarios.e2e.test.ts`):
   *  1. **400** si no viene NINGÚN campo (`activo`, `rol`, `password` o
   *     `jefatura`).
   *  2. **404** si el usuario no existe (**400** si el id no es uuid: lo dice
   *     el `UUID_PARAM` del controlador).
   *  3. **409** si se desactiva a SÍ MISMO (`sub` del JWT).
   *  4. **409** si se cambia el rol a SÍ MISMO.
   *  5. Dentro de la transacción, y SOLO si el cambio quita al usuario de
   *     `superusuario` activo: **409** si no queda NINGÚN otro superusuario
   *     activo (el conteo EXCLUYE la propia fila, es decir, el efecto del cambio).
   *  6. Escritura con el GUC del actor; la contraseña nueva se hashea con
   *     scrypt ANTES de entrar en la transacción y jamás se devuelve.
   *
   * BLINDAJE ANTE CARRERAS de la regla 5: dentro de la transacción se
   * (a) bloquea la fila del usuario con `FOR UPDATE` y (b) se bloquea la fila
   * del rol `superusuario` con `FOR UPDATE` antes de contar. Esa fila de
   * `roles` es el RECURSO COMPARTIDO del invariante: dos altas/ruedas
   * concurrentes que pudieran dejar el sistema sin superusuario se serializan
   * entre sí y la segunda re-cuenta sobre el estado ya confirmado de la primera.
   */
  async actualizar(id: string, dto: UpdateUsuarioDto, actor: string): Promise<UsuarioResponseDto> {
    if (
      dto.activo === undefined &&
      dto.rol === undefined &&
      dto.password === undefined &&
      dto.jefatura === undefined
    ) {
      throw new BadRequestException(MENSAJE_SIN_CAMBIOS);
    }

    const usuario = await this.cargarUsuario(id);

    if (usuario.id === actor) {
      if (dto.activo === false) {
        throw new ConflictException(MENSAJE_DESACTIVARSE);
      }
      if (dto.rol !== undefined) {
        throw new ConflictException(MENSAJE_CAMBIAR_ROL_PROPIO);
      }
    }
    let rolId: string | undefined;
    if (dto.rol !== undefined) {
      const rol = await this.database.query<{ id: string }>(
        'SELECT id FROM roles WHERE code = $1',
        [dto.rol],
      );
      rolId = rol.rows[0]?.id;
      if (rolId === undefined) {
        throw new BadRequestException(`No existe el rol '${dto.rol}' en el sistema`);
      }
    }

    // scrypt es lento: el hash se calcula FUERA de la transacción (sin socket
    // del pool retenido) y solo llega a BD el resultado.
    const passwordHash = dto.password === undefined ? undefined : await hashPassword(dto.password);

    return this.conActorDeAuditoria(actor, async (cliente) => {
      // Relectura fresca DENTRO de la transacción: la regla del último
      // superusuario se decide sobre el estado REAL, no sobre la lectura previa
      // (alguien pudo modificar la cuenta entre una lectura y otra). Las reglas
      // de "no desactivarse a sí mismo" comparan ids, que son inmutables, y ya
      // se resolvieron arriba sin necesidad de abrir transacción.
      const actual = await this.leerParaActualizar(cliente, id);

      await this.assertQueSigueHabiendoSuperusuario(cliente, actual, dto);

      const sets: string[] = [];
      const params: unknown[] = [];

      if (dto.activo !== undefined) {
        params.push(dto.activo);
        sets.push(`active = $${params.length}`);
      }
      if (dto.rol !== undefined) {
        params.push(rolId);
        sets.push(`role_id = $${params.length}`);
      }
      if (passwordHash !== undefined) {
        params.push(passwordHash);
        sets.push(`password_hash = $${params.length}`);
      }
      const jefatura = normalizarJefatura(dto.jefatura);
      if (jefatura !== undefined) {
        params.push(jefatura);
        sets.push(`jefatura = $${params.length}`);
      }
      params.push(id);

      const resultado = await cliente.query<{ id: string }>(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
        params,
      );
      if (resultado.rows[0]?.id === undefined) {
        // La fila estaba bloqueada/leída dentro de esta transacción: solo puede
        // desaparecer si otra transacción la borró (no existe borrado en la API).
        throw new ConflictException(`El usuario ${id} dejó de existir tras la actualización`);
      }

      // Desactivar, cambiar rol o contraseña invalida inmediatamente todas las
      // sesiones existentes del usuario. El AuthGuard también comprueba
      // `users.active`, pero la revocación explícita evita dejar basura activa.
      if (dto.activo === false || dto.rol !== undefined || passwordHash !== undefined) {
        await cliente.query(
          `UPDATE auth_sessions SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [id],
        );
      }

      // Relectura dentro de la transacción: devuelve los valores ya
      // materializados en BD (rol resuelto, `active`, `updated_at` del trigger).
      return toUsuarioResponse(await this.cargarUsuarioCon(cliente, id));
    });
  }

  // ───────────────────────── helpers privados ─────────────────────────

  /** Fila de LECTURA o 404 con mensaje claro si no existe. */
  private async cargarUsuario(id: string): Promise<UsuarioFila> {
    const resultado = await this.database.query<UsuarioFila>(
      `SELECT ${COLUMNAS_USUARIO} ${FROM_USUARIOS} WHERE u.id = $1`,
      [id],
    );
    const fila = resultado.rows[0];
    if (fila === undefined) {
      throw new NotFoundException(`No existe un usuario con id ${id}`);
    }
    return fila;
  }

  /** Igual que `cargarUsuario`, pero sobre la CONEXIÓN de la transacción en curso. */
  private async cargarUsuarioCon(cliente: PoolClient, id: string): Promise<UsuarioFila> {
    const resultado = await cliente.query<UsuarioFila>(
      `SELECT ${COLUMNAS_USUARIO} ${FROM_USUARIOS} WHERE u.id = $1`,
      [id],
    );
    const fila = resultado.rows[0];
    if (fila === undefined) {
      throw new NotFoundException(`No existe un usuario con id ${id}`);
    }
    return fila;
  }

  /** Lectura con `FOR UPDATE` de la fila (bloquea el registro hasta el COMMIT). */
  private async leerParaActualizar(cliente: PoolClient, id: string): Promise<UsuarioFila> {
    const resultado = await cliente.query<UsuarioFila>(
      `SELECT ${COLUMNAS_USUARIO} ${FROM_USUARIOS} WHERE u.id = $1 FOR UPDATE OF u`,
      [id],
    );
    const fila = resultado.rows[0];
    if (fila === undefined) {
      throw new NotFoundException(`No existe un usuario con id ${id}`);
    }
    return fila;
  }

  /**
   * Regla del ÚLTIMO superusuario activo.
   *
   * Solo aplica cuando el cambio convierte a un superusuario activo en algo
   * distinto (le quita el rol o lo desactiva): en ese caso debe quedar al
   * MENOS OTRO superusuario activo. El conteo EXCLUYE la propia fila, que es
   * exactamente "excluir el efecto del cambio".
   *
   * Se ejecuta SIEMPRE dentro de la transacción y después de bloquear la fila
   * del rol `superusuario` (`FOR UPDATE`), para serializar las escrituras que
   * tocan este invariante y cerrar la carrera de dos desactivaciones
   * simultáneas que dejarían el sistema sin ningún IT.
   */
  private async assertQueSigueHabiendoSuperusuario(
    cliente: PoolClient,
    actual: UsuarioFila,
    dto: UpdateUsuarioDto,
  ): Promise<void> {
    const esSuperusuarioActivo = actual.rol === ROL_SUPERUSUARIO && actual.activo;
    const nuevoRol = dto.rol ?? actual.rol;
    const nuevoActivo = dto.activo ?? actual.activo;
    const seguiraSuperusuarioActivo = nuevoRol === ROL_SUPERUSUARIO && nuevoActivo;

    if (!esSuperusuarioActivo || seguiraSuperusuarioActivo) {
      return;
    }

    await cliente.query('SELECT id FROM roles WHERE code = $1 FOR UPDATE', [ROL_SUPERUSUARIO]);

    const otros = await cliente.query<{ total: number }>(
      `SELECT count(*)::int AS total
         ${FROM_USUARIOS}
        WHERE r.code = $1 AND u.active AND u.id <> $2`,
      [ROL_SUPERUSUARIO, actual.id],
    );
    if ((otros.rows[0]?.total ?? 0) === 0) {
      throw new ConflictException(MENSAJE_ULTIMO_SUPERUSUARIO);
    }
  }

  /**
   * Ejecuta `fn` dentro de UNA transacción que fija el GUC
   * `app.current_user_id` con el `sub` del JWT: `users_audit_log` →
   * `audit_fila()` lo usa como QUIÉN ejecuta la escritura (migración 004).
   * `set_config(..., true)` es `SET LOCAL`, así que el valor muere al cerrar
   * la transacción y no contamina al resto del pool. Si `fn` falla → `ROLLBACK`
   * y se PROPAGA el error original (el 23505 llega íntegro al `catch` de
   * `crear`). Réplica EXACTA del patrón de `PostulacionesService`.
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
