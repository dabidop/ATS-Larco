import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { ESTADOS, FASES, type Estado, type Fase } from '../postulaciones-fases';

/** Tamaño de página por defecto de `GET /api/postulaciones`. */
export const DEFAULT_LIMIT = 50;

/** Límite máximo de página: evita que un `limit` enorme vacíe la memoria del pool. */
export const MAX_LIMIT = 100;

/** `''` en query string → ausente (un filtro vacío no debe filtrar por ''). */
const cadenaOVacia = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Query string de `GET /api/postulaciones` (listado paginado con filtros).
 *
 * Los tipos numéricos se convierten con `@Type(() => Number)`: el
 * ValidationPipe global corre con `transform: true`, así que `?limit=10`
 * llega como string y aquí se normaliza a `number` antes de `@IsInt`.
 *
 * `page`/`limit` llevan valor por defecto en la propia propiedad: si la clave
 * no viene en la query, class-transformer no la asigna y sobrevive el
 * inicializador (`page = 1`, `limit = 50`).
 *
 * El tablero Kanban pide `?requerimientoId=...` y agrupa los `items` por su
 * `fase`; los filtros son combinables (AND) y el orden es `created_at DESC`.
 * La unicidad de la fila (candidato + requerimiento) queda garantizada por el
 * índice `postulaciones_candidato_requerimiento_unique`, así que filtrar por
 * `candidatoId` devuelve a lo sumo una fila POR requerimiento.
 */
export class ListPostulacionesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un número entero' })
  @Min(1, { message: 'page debe ser al menos 1' })
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un número entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(MAX_LIMIT, { message: `limit no puede superar ${MAX_LIMIT}` })
  limit = DEFAULT_LIMIT;

  @IsOptional()
  @Transform(cadenaOVacia)
  // `undefined` como versión = cualquier uuid (mismo criterio que el pipe de :id).
  @IsUUID(undefined, { message: 'requerimientoId debe ser un UUID válido' })
  requerimientoId?: string;

  @IsOptional()
  @Transform(cadenaOVacia)
  @IsUUID(undefined, { message: 'candidatoId debe ser un UUID válido' })
  candidatoId?: string;

  @IsOptional()
  @Transform(cadenaOVacia)
  @IsEnum(FASES, { message: `fase debe ser una de: ${FASES.join(', ')}` })
  fase?: Fase;

  @IsOptional()
  @Transform(cadenaOVacia)
  @IsEnum(ESTADOS, { message: `estado debe ser uno de: ${ESTADOS.join(', ')}` })
  estado?: Estado;
}
