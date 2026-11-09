import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DASHBOARD_DEFAULT_LIMIT = 10;
export const DASHBOARD_MAX_LIMIT = 100;

/** Parámetros de paginación de la tabla de conversión del dashboard. */
export class ListDashboardQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un número entero' })
  @Min(1, { message: 'page debe ser al menos 1' })
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un número entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(DASHBOARD_MAX_LIMIT, {
    message: `limit no puede superar ${DASHBOARD_MAX_LIMIT}`,
  })
  limit = DASHBOARD_DEFAULT_LIMIT;
}
