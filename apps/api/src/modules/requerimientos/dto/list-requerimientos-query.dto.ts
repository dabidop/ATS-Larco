import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { EstadoRequerimiento } from '../requerimiento.entity';

/** Tamaño de página por defecto de `GET /api/requerimientos`. */
export const DEFAULT_LIMIT = 20;

/** Límite máximo de página: evita que un `limit` enorme vacíe la memoria del pool. */
export const MAX_LIMIT = 100;

/** `''` en query string → ausente (un filtro vacío no debe filtrar por ''). */
const cadenaOVacia = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Query string de `GET /api/requerimientos` (listado paginado con filtros).
 *
 * Los tipos numéricos se convierten con `@Type(() => Number)`: el
 * ValidationPipe global corre con `transform: true`, así que `?limit=10`
 * llega como string y aquí se normaliza a `number` antes de `@IsInt`.
 *
 * `page`/`limit` llevan valor por defecto en la propia propiedad: si la clave
 * no viene en la query, class-transformer no la asigna y sobrevive el
 * inicializador (`page = 1`).
 */
export class ListRequerimientosQueryDto {
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
  @IsEnum(EstadoRequerimiento, {
    message: `estado debe ser uno de: ${Object.values(EstadoRequerimiento).join(', ')}`,
  })
  estado?: EstadoRequerimiento;

  @IsOptional()
  @Transform(cadenaOVacia)
  @IsString({ message: 'jefatura debe ser una cadena de texto' })
  jefatura?: string;
}
