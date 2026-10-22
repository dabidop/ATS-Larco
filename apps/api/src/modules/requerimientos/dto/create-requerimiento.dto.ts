import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

import { ModalidadRequerimiento, UrgenciaRequerimiento } from '../requerimiento.entity';
import { IsSalarioRangoValido } from './salary-range.validator';

/**
 * Cuerpo de `POST /api/requerimientos`: las 5 SECCIONES del formulario, con
 * validación anidada (`@Type` + `@ValidateNested` instancian la clase de cada
 * sección antes de validarla).
 *
 * OJO con la combinación `@ValidateNested()` + `@IsDefined()`: el validador
 * `nested` de class-validator devuelve `true` cuando el valor es `undefined`,
 * así que SIN `@IsDefined()` una sección ausente pasaría la validación y
 * revienta después con un 500 al escribir en BD. `@IsDefined()` es lo que
 * convierte cada sección en OBLIGATORIA.
 *
 * Lo que NO aparece aquí —a propósito—:
 *  - `code`: lo genera la API (`REQ-YYYY-NNN`, generador atómico).
 *  - `estado` y `motivoRechazo`: los gestiona la máquina de estados (parte 4).
 *  - `createdBy`: lo toma el controlador del JWT (`request.user.sub`).
 * El ValidationPipe global (`whitelist` + `forbidNonWhitelisted`) responde 400
 * si el cliente envía alguno de esos campos.
 */

/** Sección 1 — identificación y jefatura. */
export class IdentificacionRequerimientoDto {
  @IsString({ message: 'titulo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'titulo es obligatorio' })
  titulo!: string;

  @IsString({ message: 'jefatura debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'jefatura es obligatoria' })
  jefatura!: string;

  @IsInt({ message: 'numeroPlazas debe ser un número entero' })
  @Min(1, { message: 'numeroPlazas debe ser al menos 1' })
  numeroPlazas!: number;

  /** Prioridad de la vacante (default `normal` en BD). */
  @IsOptional()
  @IsEnum(UrgenciaRequerimiento, {
    message: `urgencia debe ser una de: ${Object.values(UrgenciaRequerimiento).join(', ')}`,
  })
  urgencia?: UrgenciaRequerimiento;

  /** Modalidad de contratación (default `directa` en BD). */
  @IsOptional()
  @IsEnum(ModalidadRequerimiento, {
    message: `modalidad debe ser una de: ${Object.values(ModalidadRequerimiento).join(', ')}`,
  })
  modalidad?: ModalidadRequerimiento;

  /** Área LARCO solicitante (FK a `departamentos`; nullable). */
  @IsOptional()
  @IsUUID('4', { message: 'departamentoId debe ser un UUID válido' })
  departamentoId?: string;

  @IsOptional()
  @IsString({ message: 'ubicacion debe ser una cadena de texto' })
  ubicacion?: string;

  /** `'YYYY-MM-DD'` exacto: `strictSeparator` descarta fechas con hora. */
  @IsOptional()
  @IsDateString(
    { strictSeparator: true },
    { message: 'fechaRequerida debe ser una fecha válida en formato YYYY-MM-DD' },
  )
  fechaRequerida?: string;
}

/** Sección 2 — perfil profesional. */
export class PerfilRequerimientoDto {
  @IsOptional()
  @IsString({ message: 'experienciaRequerida debe ser una cadena de texto' })
  experienciaRequerida?: string;

  @IsOptional()
  @IsString({ message: 'nivelEducacion debe ser una cadena de texto' })
  nivelEducacion?: string;

  @IsString({ message: 'perfilProfesional debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'perfilProfesional es obligatorio' })
  perfilProfesional!: string;
}

/** Sección 3 — conocimientos y habilidades (arrays `text[]` en BD). */
export class ConocimientosRequerimientoDto {
  @IsArray({ message: 'conocimientos debe ser una lista' })
  @ArrayNotEmpty({ message: 'conocimientos no puede estar vacía' })
  @IsString({ each: true, message: 'cada conocimiento debe ser una cadena de texto' })
  conocimientos!: string[];

  @IsArray({ message: 'habilidades debe ser una lista' })
  @ArrayNotEmpty({ message: 'habilidades no puede estar vacía' })
  @IsString({ each: true, message: 'cada habilidad debe ser una cadena de texto' })
  habilidades!: string[];
}

/** Sección 4 — condiciones salariales y contractuales. */
export class CondicionesRequerimientoDto {
  @IsOptional()
  @IsNumber({}, { message: 'salarioMin debe ser un número' })
  @Min(0, { message: 'salarioMin no puede ser negativo' })
  salarioMin?: number;

  @IsOptional()
  @IsNumber({}, { message: 'salarioMax debe ser un número' })
  @Min(0, { message: 'salarioMax no puede ser negativo' })
  salarioMax?: number;

  @IsOptional()
  @IsString({ message: 'tipoContrato debe ser una cadena de texto' })
  tipoContrato?: string;

  @IsOptional()
  @IsString({ message: 'jornada debe ser una cadena de texto' })
  jornada?: string;
}

/** Sección 5 — justificación. */
export class JustificacionRequerimientoDto {
  @IsString({ message: 'justificacion debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'justificacion es obligatoria' })
  justificacion!: string;
}

/** Cuerpo completo de `POST /api/requerimientos`. */
export class CreateRequerimientoDto {
  @IsDefined({ message: 'identificacion es una sección obligatoria' })
  @ValidateNested()
  @Type(() => IdentificacionRequerimientoDto)
  identificacion!: IdentificacionRequerimientoDto;

  @IsDefined({ message: 'perfil es una sección obligatoria' })
  @ValidateNested()
  @Type(() => PerfilRequerimientoDto)
  perfil!: PerfilRequerimientoDto;

  @IsDefined({ message: 'conocimientos es una sección obligatoria' })
  @ValidateNested()
  @Type(() => ConocimientosRequerimientoDto)
  conocimientos!: ConocimientosRequerimientoDto;

  @IsDefined({ message: 'condiciones es una sección obligatoria' })
  @ValidateNested()
  @Type(() => CondicionesRequerimientoDto)
  @IsSalarioRangoValido()
  condiciones!: CondicionesRequerimientoDto;

  @IsDefined({ message: 'justificacion es una sección obligatoria' })
  @ValidateNested()
  @Type(() => JustificacionRequerimientoDto)
  justificacion!: JustificacionRequerimientoDto;
}
