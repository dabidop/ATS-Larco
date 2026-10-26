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

/** Estados del ENUM `estado_entrevista` (migración 009). */
export enum EstadoEntrevista {
  Agendada = 'agendada',
  Realizada = 'realizada',
  Cancelada = 'cancelada',
}

/** Recorta y colapsa espacios internos; `''` → `undefined` (para opciones). */
const textoOVacio = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || undefined : value;

/** `HH:MM` de 24 h (00:00–23:59), el formato que la UI envía y pinta. */
export const EXPRESION_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Cuerpo de `POST /api/entrevistas` (Etapa 9): agendar UNA entrevista sobre
 * una postulación existente (candidato dentro de un requerimiento).
 */
export class CrearEntrevistaDto {
  /** Postulación sobre la que se agenda (404 si no existe; 409 si es terminal). */
  @IsString({ message: 'postulacionId debe ser una cadena de texto' })
  postulacionId!: string;

  /** Fecha calendario `YYYY-MM-DD` (la BD la guarda como `date`). */
  @IsDateString({}, { message: 'fecha debe ser una fecha válida en formato YYYY-MM-DD' })
  fecha!: string;

  /** Hora `HH:MM` (opcional: a veces solo importa el día). */
  @IsOptional()
  @Matches(EXPRESION_HORA, { message: 'hora debe tener el formato HH:MM (24 horas)' })
  hora?: string;

  /** Tipo de entrevista («Psicotécnica», «Entrevista inicial», ...). */
  @IsString({ message: 'tipo debe ser una cadena de texto' })
  @Transform(textoOVacio)
  @MinLength(3, { message: 'tipo debe tener al menos 3 caracteres' })
  @MaxLength(120, { message: 'tipo no puede superar 120 caracteres' })
  tipo!: string;

  /** Nombre del entrevistador (opcional). */
  @IsOptional()
  @IsString({ message: 'entrevistador debe ser una cadena de texto' })
  @Transform(textoOVacio)
  @MaxLength(120, { message: 'entrevistador no puede superar 120 caracteres' })
  entrevistador?: string;

  /** Estado inicial (opcional; la BD arranca en `agendada`). */
  @IsOptional()
  @IsEnum(EstadoEntrevista, {
    message: `estado debe ser una de: ${Object.values(EstadoEntrevista).join(', ')}`,
  })
  estado?: EstadoEntrevista;

  /** Notas u observaciones (opcional). */
  @IsOptional()
  @IsString({ message: 'notas debe ser una cadena de texto' })
  @Transform(textoOVacio)
  @MaxLength(4000, { message: 'notas no puede superar 4000 caracteres' })
  notas?: string;
}
