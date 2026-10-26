import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager, FindOptionsWhere, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../../common/guards/auth.guard';
import { CodigoGeneratorService } from './codigo-generator.service';
import type { CreateRequerimientoDto } from './dto/create-requerimiento.dto';
import type { ListRequerimientosQueryDto } from './dto/list-requerimientos-query.dto';
import type { RequerimientoResponseDto, RequerimientosPageDto } from './dto/requerimiento.response';
import type { TransicionarRequerimientoDto } from './dto/transicionar-requerimiento.dto';
import type { UpdateRequerimientoDto } from './dto/update-requerimiento.dto';
import { EstadoRequerimiento, Requerimiento } from './requerimiento.entity';
import { TRANSICIONES_VALIDAS, denegacionPermiso } from './requerimientos-flujo';
import { buildCreateData, buildUpdateData, toResponse } from './requerimientos.mapper';
import { RequerimientosStoreService } from './requerimientos-store.service';

/** Rol con poderes de administración sobre los requerimientos (RBAC). */
const ROLE_ADMIN = 'admin_rrhh';

/**
 * Heredero directo de `admin_rrhh` (migración 008, Etapa 8B): el
 * `superusuario` (IT) edita requerimientos ajenos con el MISMO poder que RRHH.
 */
const ROLE_SUPERUSUARIO = 'superusuario';

/**
 * Campos obligatorios de la entidad: un `PATCH` no puede dejarlos vacíos
 * (las columnas son NOT NULL en BD y la API responde 400 en vez del 500 que
 * devolvería el CHECK de la base de datos).
 */
const CAMPOS_OBLIGATORIOS: ReadonlyArray<{ campo: keyof Requerimiento; etiqueta: string }> = [
  { campo: 'titulo', etiqueta: 'titulo' },
  { campo: 'jefatura', etiqueta: 'jefatura' },
  { campo: 'numeroPlazas', etiqueta: 'numeroPlazas' },
  { campo: 'perfilProfesional', etiqueta: 'perfilProfesional' },
  { campo: 'justificacion', etiqueta: 'justificacion' },
];

/**
 * Lógica de CRUD de los requerimientos de personal (Fase 3, parte 3).
 *
 * La persistencia va SIEMPRE por `RequerimientosStoreService` (DataSource
 * perezoso) y el código correlativo sale del `CodigoGeneratorService`.
 *
 * NOTA sobre atomicidad de `create`: `siguienteCodigo()` abre SU propia
 * transacción (el upsert atómico de la parte 2), así que el INSERT del
 * requerimiento es una operación posterior y NO está en la misma transacción
 * (TypeORM no admite transacciones anidadas sin savepoints). Si el INSERT
 * fallara, el número reservado queda consumido: se produce un HUECO en la
 * correlación, nunca un duplicado (el `code` es UNIQUE en BD) ni una pérdida
 * de datos.
 */
@Injectable()
export class RequerimientosService {
  constructor(
    private readonly store: RequerimientosStoreService,
    private readonly codigoGenerator: CodigoGeneratorService,
  ) {}

  /**
   * 404 si `departamentoId` viene informado y NO existe (Etapa 9): el cuerpo
   * nunca debe provocar un 500 de FK violada. Ausente o `null` no comprueban
   * (desasociar el requerimiento de su área siempre es válido).
   */
  private async assertDepartamentoExiste(
    repo: Repository<Requerimiento>,
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
   * Crea un requerimiento con las 5 secciones del formulario.
   *
   * El código `REQ-YYYY-NNN` lo genera el servicio de códigos y el estado
   * arranca SIEMPRE en `pendiente`; `createdBy` llega del JWT y no del cuerpo.
   */
  async create(dto: CreateRequerimientoDto, createdBy: string): Promise<RequerimientoResponseDto> {
    const code = await this.codigoGenerator.siguienteCodigo();
    const repo = await this.store.repo();

    await this.assertDepartamentoExiste(repo, dto.identificacion.departamentoId);

    const entidad = repo.create({
      code,
      estado: EstadoRequerimiento.Pendiente,
      createdBy,
      ...buildCreateData(dto),
    });
    const guardada = await repo.save(entidad);

    return toResponse(guardada);
  }

  /**
   * Listado paginado ordenado por `created_at DESC`, con filtros opcionales
   * por `estado`, `jefatura`, `urgencia`, `modalidad` y `departamentoId`
   * (los dos últimos los añadió la Etapa 9). Devuelve el total de filas
   * filtradas para que el cliente calcule el número de páginas.
   */
  async list(query: ListRequerimientosQueryDto): Promise<RequerimientosPageDto> {
    const repo = await this.store.repo();

    const where: FindOptionsWhere<Requerimiento> = {};
    if (query.estado !== undefined) {
      where.estado = query.estado;
    }
    if (query.jefatura !== undefined) {
      where.jefatura = query.jefatura;
    }
    if (query.urgencia !== undefined) {
      where.urgencia = query.urgencia;
    }
    if (query.modalidad !== undefined) {
      where.modalidad = query.modalidad;
    }
    if (query.departamentoId !== undefined) {
      where.departamentoId = query.departamentoId;
    }

    const [entidades, total] = await repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    });

    return { items: entidades.map(toResponse), total, page: query.page, limit: query.limit };
  }

  /** Detalle por id; 404 con mensaje claro si no existe. */
  async findById(id: string): Promise<RequerimientoResponseDto> {
    const repo = await this.store.repo();
    const entidad = await repo.findOneBy({ id });
    if (entidad === null) {
      throw new NotFoundException(`No existe un requerimiento con id ${id}`);
    }
    return toResponse(entidad);
  }

  /**
   * Actualización parcial.
   *
   * Reglas, en este orden:
   *  1. 404 si el requerimiento no existe.
   *  2. 409 si no está `pendiente`: el ciclo de vida lo decide la máquina de
   *     estados (parte 4); editar un requerimiento aprobado/en proceso ya
   *     rompería la trazabilidad.
   *  3. 403 si no lo creó el usuario actual y no es `admin_rrhh` ni
   *     `superusuario`.
   *  4. 400 si el cambio dejaría un campo obligatorio vacío o el rango
   *     salarial inconsistente (el CHECK de BD devolvería un 500).
   *
   * Solo se escriben los campos presentes en el cuerpo (`buildUpdateData`).
   *
   * La escritura va DENTRO de una transacción que fija el GUC
   * `app.current_user_id` con el `sub` del usuario: así `audit_log.changed_by`
   * registra a QUIÉN edita (migración 004), no al `created_by` de la fila.
   */
  async update(
    id: string,
    dto: UpdateRequerimientoDto,
    user: AuthenticatedUser,
  ): Promise<RequerimientoResponseDto> {
    const repo = await this.store.repo();
    const entidad = await repo.findOneBy({ id });
    if (entidad === null) {
      throw new NotFoundException(`No existe un requerimiento con id ${id}`);
    }

    if (entidad.estado !== EstadoRequerimiento.Pendiente) {
      throw new ConflictException(
        `Solo se pueden editar requerimientos en estado pendiente (actual: ${entidad.estado})`,
      );
    }

    // `admin_rrhh` y su heredero `superusuario` (Etapa 8B) editan cualquier
    // fila; el resto solo lo que creó.
    const esAdministrador = user.role === ROLE_ADMIN || user.role === ROLE_SUPERUSUARIO;
    if (entidad.createdBy !== user.sub && !esAdministrador) {
      throw new ForbiddenException(
        'Solo el creador del requerimiento o un administrador de RRHH pueden modificarlo',
      );
    }

    const cambios = buildUpdateData(dto);
    if (dto.identificacion?.departamentoId !== undefined) {
      await this.assertDepartamentoExiste(repo, dto.identificacion.departamentoId);
    }
    const resultado: Requerimiento = { ...entidad, ...cambios };
    this.assertCamposObligatorios(resultado);
    this.assertRangoSalarial(resultado);

    // Escritura en transacción: fija el GUC del actor ANTES del UPDATE para
    // que `audit_log.changed_by` sea QUIÉN edita y no el `created_by` de la
    // fila (migración 004). El resultado observable para el creador es el
    // mismo de siempre; ahora el admin que edita también queda registrado.
    return this.store.withTransaction(async (em) => {
      await this.fijarActorDeAuditoria(em, user.sub);
      const guardada = await em.save(Requerimiento, resultado);
      return toResponse(guardada);
    });
  }

  /**
   * Transición de estado (Fase 3, parte 4): `POST /:id/transiciones`.
   *
   * Reglas, en este orden:
   *  1. 404 si el requerimiento no existe.
   *  2. 409 si `actual → destino` no está en `TRANSICIONES_VALIDAS` —mensaje
   *     con los destinos válidos— o el estado es `cerrado`/`rechazado`
   *     (terminal: sin salida).
   *  3. 403 si el rol del usuario no está en `PERMISOS_TRANSICION` para esa
   *     transición —incluida la regla extra de que un `lider_area` solo RETIRA
   *     SU propia solicitud en `pendiente → rechazado` (no la de otro líder)—.
   *  4. 400 si `destino = 'rechazado'` y falta `motivo` (el CHECK
   *     `requerimientos_rechazo_check` también lo garantiza en BD, pero el
   *     error debe salir como 400 del API, no como 500 del trigger).
   *  5. Dentro de `withTransaction`: fija el GUC `app.current_user_id` con el
   *     `sub` del usuario (auditoría del QUE EJECUTA, migración 004) y hace el
   *     UPDATE con criterio `estado = origen` como blindaje ante carreras: si
   *     otra petición cambió el estado en medio, `affected = 0` → 409.
   *
   * `motivo_rechazo` solo se escribe al rechazar; el resto de destinos NO lo
   * tocan. Devuelve la fila ACTUALIZADA con la MISMA forma que el CRUD
   * (`toResponse`), no un sub-recurso.
   */
  async transicionar(
    id: string,
    dto: TransicionarRequerimientoDto,
    user: AuthenticatedUser,
  ): Promise<RequerimientoResponseDto> {
    const repo = await this.store.repo();
    const entidad = await repo.findOneBy({ id });
    if (entidad === null) {
      throw new NotFoundException(`No existe un requerimiento con id ${id}`);
    }

    const origen = entidad.estado;
    const destino = dto.destino;
    const esCreador = entidad.createdBy === user.sub;

    // 409 — la transición debe existir en la máquina de estados ANTES de
    // mirar permisos: "eso no se puede hacer" ≠ "a ti no te dejamos hacerlo".
    const destinosValidos = TRANSICIONES_VALIDAS[origen];
    if (!destinosValidos.includes(destino)) {
      if (destinosValidos.length === 0) {
        throw new ConflictException(
          `Estado terminal: el requerimiento está en '${origen}' y no admite nuevas transiciones`,
        );
      }
      throw new ConflictException(
        `Transición no permitida: ${origen} → ${destino}. ` +
          `Destinos válidos desde ${origen}: [${destinosValidos.join(', ')}]`,
      );
    }

    // 403 — matriz de permisos por rol (incluye la regla del creador).
    const denegacion = denegacionPermiso(origen, destino, user.role, esCreador);
    if (denegacion !== null) {
      throw new ForbiddenException(denegacion);
    }

    // 400 — rechazar o cerrar exigen decir por qué (viajan recortados). Cerrar
    // además pregunta SI SE CONTRATÓ (Etapa 9: resultado_cierre, CHECK de BD).
    const esRechazo = destino === EstadoRequerimiento.Rechazado;
    const esCierre = destino === EstadoRequerimiento.Cerrado;
    const motivo = dto.motivo?.trim() ?? null;
    if (esRechazo && motivo === null) {
      throw new BadRequestException(
        'Para rechazar un requerimiento el campo "motivo" es obligatorio',
      );
    }
    if (esCierre && motivo === null) {
      throw new BadRequestException(
        'Para cerrar un requerimiento el campo "motivo" es obligatorio',
      );
    }
    if (esCierre && dto.resultado === undefined) {
      throw new BadRequestException(
        'Para cerrar un requerimiento el campo "resultado" es obligatorio: ' +
          `'contratacion' (se contrató a alguien) o 'cierre_vacante' (se cerró sin contratar)`,
      );
    }

    return this.store.withTransaction(async (em) => {
      // SET LOCAL parametrizado (el uuid NUNCA se interpola a mano): el
      // trigger `audit_fila()` (migración 004) prioriza este GUC sobre
      // `NEW.created_by`, de modo que `audit_log.changed_by` registra al QUE
      // EJECUTA la transición, no al autor de la solicitud. Al ser `is_local`,
      // el valor muere con la transacción y no se filtra al resto del pool.
      await this.fijarActorDeAuditoria(em, user.sub);

      const cambios = esRechazo
        ? { estado: destino, motivoRechazo: motivo }
        : esCierre
          ? { estado: destino, motivoCierre: motivo, resultadoCierre: dto.resultado }
          : { estado: destino };
      const resultado = await em.update(Requerimiento, { id, estado: origen }, cambios);
      if (resultado.affected === 0) {
        throw new ConflictException(
          `Conflicto: el requerimiento cambió de estado mientras se procesaba ` +
            `${origen} → ${destino}; vuelve a intentarlo`,
        );
      }

      // Relectura dentro de la transacción: devuelve el `updated_at` que dejó
      // el trigger `set_updated_at` y los valores ya materializados en BD.
      const actualizada = await em.findOneBy(Requerimiento, { id });
      if (actualizada === null) {
        throw new ConflictException(`El requerimiento ${id} dejó de existir tras la transición`);
      }
      return toResponse(actualizada);
    });
  }

  /**
   * Fija `app.current_user_id` (SET LOCAL, valor parametrizado con `$1`) en la
   * conexión de la transacción EN CURSO: `audit_fila()` lo usa como QUIÉN
   * ejecuta la escritura. `is_local = true` → el GUC se revierte al terminar
   * la transacción, así que no contamina a otras peticiones que reutilicen el
   * mismo socket del pool.
   */
  private async fijarActorDeAuditoria(em: EntityManager, sub: string): Promise<void> {
    await em.query(`SELECT set_config('app.current_user_id', $1, true)`, [sub]);
  }

  /**
   * El rango salarial se revalida contra el VALOR RESULTANTE (cambio + fila
   * guardada): un `PATCH` que solo sube `salarioMin` por encima del
   * `salarioMax` existente violaría el CHECK de BD con un 500.
   */
  private assertRangoSalarial(entidad: Requerimiento): void {
    const { salarioMin, salarioMax } = entidad;
    if (
      typeof salarioMin === 'number' &&
      typeof salarioMax === 'number' &&
      salarioMin > salarioMax
    ) {
      throw new BadRequestException('El salario mínimo no puede ser mayor que el salario máximo');
    }
  }

  /** Impide que un `PATCH` deje vacío un campo obligatorio (columna NOT NULL). */
  private assertCamposObligatorios(entidad: Requerimiento): void {
    for (const { campo, etiqueta } of CAMPOS_OBLIGATORIOS) {
      const valor = entidad[campo];
      if (valor === null || valor === undefined || valor === '') {
        throw new BadRequestException(`${etiqueta} es obligatorio y no puede quedar vacío`);
      }
    }
  }
}
