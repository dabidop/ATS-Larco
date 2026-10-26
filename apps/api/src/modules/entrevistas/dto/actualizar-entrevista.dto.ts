import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { EstadoEntrevista, EXPRESION_HORA } from './crear-entrevista.dto';

/** Recorta y colapsa espacios internos; `''` → `undefined` (para opciones). */
const textoOVacio = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || undefined : value;

/**
 * Cuerpo de `PATCH /api/entrevistas/:id` (Etapa 9): todos los campos son
 * OPCIONALES y solo se actualizan los informados (redeclarados a mano porque
 * `@nestjs/mapped-types` no está instalado, mismo criterio que
 * `UpdateCandidatoDto`). `postulacionId` NO se incluye: una entrevista
 * pertenece a su postulación para siempre.
 */
export class ActualizarEntrevistaDto {
  @IsOptional()
  @IsDateString({}, { message: 'fecha debe ser una fecha válida en formato YYYY-MM-DD' })
  fecha?: string;

  @IsOptional()
  @Matches(EXPRESION_HORA, { message: 'hora debe tener el formato HH:MM (24 horas)' })
  hora?: string;

  @IsOptional()
  @IsString({ message: 'tipo debe ser una cadena de texto' })
  @Transform(textoOVacio)
  @MinLength(3, { message: 'tipo debe tener al menos 3 caracteres' })
  @MaxLength(120, { message: 'tipo no puede superar 120 caracteres' })
  tipo?: string;

  @IsOptional()
  @IsString({ message: 'entrevistador debe ser una cadena de texto' })
  @Transform(textoOVacio)
  @MaxLength(120, { message: 'entrevistador no puede superar 120 caracteres' })
  entrevistador?: string;

  @IsOptional()
  @IsEnum(EstadoEntrevista, {
    message: `estado debe ser una de: ${Object.values(EstadoEntrevista).join(', ')}`,
  })
  estado?: EstadoEntrevista;

  @IsOptional()
  @IsString({ message: 'notas debe ser una cadena de texto' })
  @Transform(textoOVacio)
  @MaxLength(4000, { message: 'notas no puede superar 4000 caracteres' })
  notas?: string;
}
