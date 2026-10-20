import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FindOptionsWhere } from 'typeorm';

import type { AuthenticatedUser } from '../../common/guards/auth.guard';
import { CodigoGeneratorService } from './codigo-generator.service';
import type { CreateRequerimientoDto } from './dto/create-requerimiento.dto';
import type { ListRequerimientosQueryDto } from './dto/list-requerimientos-query.dto';
import type { RequerimientoResponseDto, RequerimientosPageDto } from './dto/requerimiento.response';
import type { UpdateRequerimientoDto } from './dto/update-requerimiento.dto';
import { EstadoRequerimiento, type Requerimiento } from './requerimiento.entity';
import { buildCreateData, buildUpdateData, toResponse } from './requerimientos.mapper';
import { RequerimientosStoreService } from './requerimientos-store.service';

/** Rol con poderes de administración sobre los requerimientos (RBAC). */
const ROLE_ADMIN = 'admin_rrhh';

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
   * Crea un requerimiento con las 5 secciones del formulario.
   *
   * El código `REQ-YYYY-NNN` lo genera el servicio de códigos y el estado
   * arranca SIEMPRE en `pendiente`; `createdBy` llega del JWT y no del cuerpo.
   */
  async create(dto: CreateRequerimientoDto, createdBy: string): Promise<RequerimientoResponseDto> {
    const code = await this.codigoGenerator.siguienteCodigo();
    const repo = await this.store.repo();

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
   * por `estado` y `jefatura`. Devuelve el total de filas filtradas para que
   * el cliente calcule el número de páginas.
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
   *  3. 403 si no lo creó el usuario actual y no es `admin_rrhh`.
   *  4. 400 si el cambio dejaría un campo obligatorio vacío o el rango
   *     salarial inconsistente (el CHECK de BD devolvería un 500).
   *
   * Solo se escriben los campos presentes en el cuerpo (`buildUpdateData`).
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

    const esAdministrador = user.role === ROLE_ADMIN;
    if (entidad.createdBy !== user.sub && !esAdministrador) {
      throw new ForbiddenException(
        'Solo el creador del requerimiento o un administrador de RRHH pueden modificarlo',
      );
    }

    const cambios = buildUpdateData(dto);
    const resultado: Requerimiento = { ...entidad, ...cambios };
    this.assertCamposObligatorios(resultado);
    this.assertRangoSalarial(resultado);

    const guardada = await repo.save(resultado);
    return toResponse(guardada);
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
