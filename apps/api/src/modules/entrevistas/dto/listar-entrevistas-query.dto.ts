import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { EstadoEntrevista } from './crear-entrevista.dto';

/** `''` → `undefined` (un filtro vacío no filtra). */
const cadenaOVacia = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Query de `GET /api/entrevistas` (Etapa 9): la agenda con filtros combinables
 * (Y lógico). Sin parámetros devuelve TODAS las entrevistas ordenadas por
 * fecha ascendente (la vista agenda del módulo «Entrevistas»).
 */
export class ListarEntrevistasQueryDto {
  /** Incluir solo entrevistas con `fecha >= desde` (inclusive). */
  @IsOptional()
  @IsDateString({}, { message: 'desde debe ser una fecha válida en formato YYYY-MM-DD' })
  desde?: string;

  /** Incluir solo entrevistas con `fecha <= hasta` (inclusive). */
  @IsOptional()
  @IsDateString({}, { message: 'hasta debe ser una fecha válida en formato YYYY-MM-DD' })
  hasta?: string;

  /** Filtro exacto por estado (`agendada`, `realizada`, `cancelada`). */
  @IsOptional()
  @IsEnum(EstadoEntrevista, {
    message: `estado debe ser una de: ${Object.values(EstadoEntrevista).join(', ')}`,
  })
  estado?: EstadoEntrevista;

  /** Filtro por postulación (ver la agenda de UN candidato en UN requerimiento). */
  @IsOptional()
  @Transform(cadenaOVacia)
  @IsUUID('4', { message: 'postulacionId debe ser un UUID válido' })
  postulacionId?: string;

  /** Filtro por candidato (todas sus entrevistas, en cualquier requerimiento). */
  @IsOptional()
  @Transform(cadenaOVacia)
  @IsUUID('4', { message: 'candidatoId debe ser un UUID válido' })
  candidatoId?: string;
}
