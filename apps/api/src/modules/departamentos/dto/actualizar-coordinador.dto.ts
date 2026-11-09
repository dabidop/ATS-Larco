import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Cuerpo de `PATCH /api/departamentos/:id` (Etapa 9).
 *
 * El catálogo de áreas es el SEED de LARCO (migración 009): no se crean ni se
 * borran departamentos, solo se actualiza su COORDINADOR. Por eso el DTO solo
 * acepta ese campo (con `forbidNonWhitelisted` global, `nombre` en el cuerpo
 * produce 400).
 */
export class ActualizarDepartamentoDto {
  /** Usuario líder que quedará asignado al área. */
  @IsOptional()
  @IsUUID('4', { message: 'coordinadorId debe ser un UUID válido' })
  coordinadorId?: string;

  /** Nombre completo del coordinador nuevo (min 3 para evitar «J»). */
  @IsOptional()
  @IsString({ message: 'coordinador debe ser una cadena de texto' })
  @MinLength(3, { message: 'coordinador debe tener al menos 3 caracteres' })
  @MaxLength(120, { message: 'coordinador no puede superar 120 caracteres' })
  coordinador?: string;
}
