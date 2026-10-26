import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

import { CEDULA_MENSAJE, CEDULA_PATTERN } from './create-candidato.dto';

/** Tamaño de página por defecto de `GET /api/candidatos`. */
export const DEFAULT_LIMIT = 20;

/** Límite máximo de página: evita que un `limit` enorme vacíe la memoria del pool. */
export const MAX_LIMIT = 100;

/** `''` en query string → ausente (un filtro vacío no debe filtrar por ''). */
const cadenaOVacia = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Query string de `GET /api/candidatos` (listado paginado con filtros).
 *
 * Los tipos numéricos se convierten con `@Type(() => Number)`: el
 * ValidationPipe global corre con `transform: true`, así que `?limit=10`
 * llega como string y aquí se normaliza a `number` antes de `@IsInt`.
 *
 * `page`/`limit` llevan valor por defecto en la propia propiedad: si la clave
 * no viene en la query, class-transformer no la asigna y sobrevive el
 * inicializador (`page = 1`).
 *
 * Dos formas de filtrar, con estrategias MUY distintas:
 *  - `q`: búsqueda PARCIAL (ILIKE) sobre nombres/apellidos/ciudad/cargo_actual.
 *  - `cedula`: búsqueda EXACTA por cédula; el servicio la convierte a
 *    `cedula_hash` (HMAC) y filtra SIN descifrar la columna cifrada.
 */
export class ListCandidatosQueryDto {
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
  @IsString({ message: 'cedula debe ser una cadena de texto' })
  @Matches(CEDULA_PATTERN, { message: CEDULA_MENSAJE })
  cedula?: string;

  /** Filtro exacto por área LARCO (tag de «Base de Talentos», Etapa 9). */
  @IsOptional()
  @Transform(cadenaOVacia)
  @IsUUID('4', { message: 'departamentoId debe ser un UUID válido' })
  departamentoId?: string;
}
