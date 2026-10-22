import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { ROL_MENSAJE, ROLES_VALIDOS } from './create-usuario.dto';

/** Tamaño de página por defecto de `GET /api/usuarios`. */
export const DEFAULT_LIMIT = 20;

/** Límite máximo de página: evita que un `limit` enorme vacíe la memoria del pool. */
export const MAX_LIMIT = 100;

/** `''` en query string → ausente (un filtro vacío no debe filtrar por ''). */
const cadenaOVacia = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Query string de `GET /api/usuarios` (listado paginado con filtros).
 *
 * Réplica del patrón de `list-candidatos-query.dto.ts`: los tipos numéricos se
 * convierten con `@Type(() => Number)` (el ValidationPipe global corre con
 * `transform: true`, así que `?limit=10` llega como string y aquí se
 * normaliza a `number` antes de `@IsInt`), y `page`/`limit` llevan valor por
 * defecto en la propia propiedad: si la clave no viene en la query,
 * class-transformer no la asigna y sobrevive el inicializador.
 *
 * Dos filtros combinables (AND):
 *  - `q`: búsqueda PARCIAL (ILIKE) sobre `full_name` y `email`.
 *  - `rol`: código EXACTO de `roles.code`.
 */
export class ListUsuariosQueryDto {
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
  @IsString({ message: 'q debe ser una cadena de texto' })
  q?: string;

  @IsOptional()
  @Transform(cadenaOVacia)
  @IsString({ message: 'rol debe ser una cadena de texto' })
  @IsIn(ROLES_VALIDOS, { message: ROL_MENSAJE })
  rol?: string;
}
