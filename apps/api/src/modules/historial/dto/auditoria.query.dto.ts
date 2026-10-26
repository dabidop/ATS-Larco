import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Query de `GET /api/historial/auditoria` (Etapa 9, regla 7: la bitácora es
 * visible para el `superusuario`). Filtros combinables (Y lógico) + paginación
 * clásica `pagina`/`limite`.
 */
export class AuditoriaQueryDto {
  /** Página 1-based (por defecto 1). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pagina debe ser un número entero' })
  @Min(1, { message: 'pagina debe ser al menos 1' })
  pagina?: number;

  /** Registros por página (por defecto 50, máximo 200). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limite debe ser un número entero' })
  @Min(1, { message: 'limite debe ser al menos 1' })
  @Max(200, { message: 'limite no puede superar 200' })
  limite?: number;

  /** Tabla exacta auditada (`candidatos`, `postulaciones`, `requerimientos`, ...). */
  @IsOptional()
  @IsString({ message: 'tabla debe ser una cadena de texto' })
  @MaxLength(100, { message: 'tabla no puede superar 100 caracteres' })
  tabla?: string;

  /** UUID del usuario que ejecutó la escritura (`audit_log.changed_by`). */
  @IsOptional()
  @IsUUID('4', { message: 'actor debe ser un UUID válido' })
  actor?: string;

  /** id del registro auditado (texto: `audit_log.record_id` es `text`). */
  @IsOptional()
  @IsString({ message: 'recordId debe ser una cadena de texto' })
  @MaxLength(100, { message: 'recordId no puede superar 100 caracteres' })
  recordId?: string;

  /** Fecha-hora ISO desde la cual mostrar registros (inclusive). */
  @IsOptional()
  @IsDateString({}, { message: 'desde debe ser una fecha-hora válida en formato ISO' })
  desde?: string;

  /** Fecha-hora ISO hasta la cual mostrar registros (inclusive). */
  @IsOptional()
  @IsDateString({}, { message: 'hasta debe ser una fecha-hora válida en formato ISO' })
  hasta?: string;
}
