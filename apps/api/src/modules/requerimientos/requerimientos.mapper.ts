import type { CreateRequerimientoDto } from './dto/create-requerimiento.dto';
import type { RequerimientoResponseDto } from './dto/requerimiento.response';
import type { UpdateRequerimientoDto } from './dto/update-requerimiento.dto';
import type { Requerimiento } from './requerimiento.entity';

/**
 * Mapeo EXPLÍCITO DTO ↔ entidad del módulo de requerimientos.
 *
 * La API habla camelCase (`numeroPlazas`, `salarioMin`), la entidad también en
 * propiedades pero con columnas snake_case (`numero_plazas`, `salario_min`) y
 * la BD añade sus propios nombres. Este fichero es el ÚNICO punto donde esas
 * tres vistas se cruzan: los servicios nunca leen `dto.identificacion.titulo`
 * directamente ni la entidad se serializa tal cual.
 *
 * Dos funciones de entrada (creación y actualización) porque no son simétricas:
 * la creación exige las 5 secciones completas; la actualización parte de las
 * secciones presentes y deja el resto intacto.
 */

/**
 * Campos de `Requerimiento` que la API SÍ puede escribir. Excluye los que
 * gestiona el sistema: `id` y timestamps (BD), `code` (generador atómico),
 * `estado` (máquina de estados, parte 4), `createdBy` (JWT) y `motivoRechazo`
 * (solo al rechazar, parte 4).
 */
export type RequerimientoEditable = Omit<
  Requerimiento,
  'id' | 'code' | 'estado' | 'createdBy' | 'motivoRechazo' | 'createdAt' | 'updatedAt'
>;

/**
 * DTO de creación → datos de la entidad (las 5 secciones, completas).
 *
 * Los opcionales del DTO (`undefined`) se traducen a `null`: las columnas son
 * `NULL` en BD y la entidad declara `string | null`, no `string | undefined`.
 */
export function buildCreateData(dto: CreateRequerimientoDto): RequerimientoEditable {
  return {
    titulo: dto.identificacion.titulo,
    jefatura: dto.identificacion.jefatura,
    numeroPlazas: dto.identificacion.numeroPlazas,
    ubicacion: dto.identificacion.ubicacion ?? null,
    fechaRequerida: dto.identificacion.fechaRequerida ?? null,
    experienciaRequerida: dto.perfil.experienciaRequerida ?? null,
    nivelEducacion: dto.perfil.nivelEducacion ?? null,
    perfilProfesional: dto.perfil.perfilProfesional,
    conocimientos: dto.conocimientos.conocimientos,
    habilidades: dto.conocimientos.habilidades,
    salarioMin: dto.condiciones.salarioMin ?? null,
    salarioMax: dto.condiciones.salarioMax ?? null,
    tipoContrato: dto.condiciones.tipoContrato ?? null,
    jornada: dto.condiciones.jornada ?? null,
    justificacion: dto.justificacion.justificacion,
  };
}

/**
 * DTO de actualización → PARCIAL de la entidad: solo los campos presentes.
 *
 * `undefined` significa "no viene en el cuerpo" y por tanto "sin cambios"; los
 * campos ausentes NO aparecen en el resultado, de modo que `save()` no los
 * pisa. Un `null` explícito sí viaja (permite vaciar una columna nullable);
 * los campos NO nullable se protegen en el servicio antes de escribir.
 */
export function buildUpdateData(dto: UpdateRequerimientoDto): Partial<RequerimientoEditable> {
  const cambios: Partial<RequerimientoEditable> = {};
  const { identificacion, perfil, conocimientos, condiciones, justificacion } = dto;

  if (identificacion !== undefined) {
    if (identificacion.titulo !== undefined) cambios.titulo = identificacion.titulo;
    if (identificacion.jefatura !== undefined) cambios.jefatura = identificacion.jefatura;
    if (identificacion.numeroPlazas !== undefined)
      cambios.numeroPlazas = identificacion.numeroPlazas;
    if (identificacion.ubicacion !== undefined) cambios.ubicacion = identificacion.ubicacion;
    if (identificacion.fechaRequerida !== undefined) {
      cambios.fechaRequerida = identificacion.fechaRequerida;
    }
  }

  if (perfil !== undefined) {
    if (perfil.experienciaRequerida !== undefined) {
      cambios.experienciaRequerida = perfil.experienciaRequerida;
    }
    if (perfil.nivelEducacion !== undefined) cambios.nivelEducacion = perfil.nivelEducacion;
    if (perfil.perfilProfesional !== undefined) {
      cambios.perfilProfesional = perfil.perfilProfesional;
    }
  }

  if (conocimientos !== undefined) {
    if (conocimientos.conocimientos !== undefined)
      cambios.conocimientos = conocimientos.conocimientos;
    if (conocimientos.habilidades !== undefined) cambios.habilidades = conocimientos.habilidades;
  }

  if (condiciones !== undefined) {
    if (condiciones.salarioMin !== undefined) cambios.salarioMin = condiciones.salarioMin;
    if (condiciones.salarioMax !== undefined) cambios.salarioMax = condiciones.salarioMax;
    if (condiciones.tipoContrato !== undefined) cambios.tipoContrato = condiciones.tipoContrato;
    if (condiciones.jornada !== undefined) cambios.jornada = condiciones.jornada;
  }

  if (justificacion?.justificacion !== undefined) {
    cambios.justificacion = justificacion.justificacion;
  }

  return cambios;
}

/**
 * Entidad → respuesta HTTP (camelCase, fechas en ISO 8601).
 *
 * Los arrays se devuelven tal cual (TypeORM ya hidrató `text[]` como
 * `string[]`) y los `numeric` ya pasaron por el transformer de la entidad
 * (`string` de `pg` → `number`).
 */
export function toResponse(entidad: Requerimiento): RequerimientoResponseDto {
  return {
    id: entidad.id,
    code: entidad.code,
    estado: entidad.estado,
    createdBy: entidad.createdBy,
    titulo: entidad.titulo,
    jefatura: entidad.jefatura,
    numeroPlazas: entidad.numeroPlazas,
    ubicacion: entidad.ubicacion,
    fechaRequerida: entidad.fechaRequerida,
    experienciaRequerida: entidad.experienciaRequerida,
    nivelEducacion: entidad.nivelEducacion,
    perfilProfesional: entidad.perfilProfesional,
    conocimientos: entidad.conocimientos,
    habilidades: entidad.habilidades,
    salarioMin: entidad.salarioMin,
    salarioMax: entidad.salarioMax,
    tipoContrato: entidad.tipoContrato,
    jornada: entidad.jornada,
    justificacion: entidad.justificacion,
    motivoRechazo: entidad.motivoRechazo,
    createdAt: entidad.createdAt.toISOString(),
    updatedAt: entidad.updatedAt.toISOString(),
  };
}
