import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

import { IsSalarioRangoValido } from './salary-range.validator';

/**
 * Cuerpo de `PATCH /api/requerimientos/:id`.
 *
 * TODO es opcional y las secciones ausentes significan "sin cambios": se
 * actualiza únicamente lo que viene en el cuerpo.
 *
 * `@nestjs/mapped-types` NO está instalado en el workspace, así que las versiones
 * parciales de cada sección se declaran a mano (mismo patrón que
 * `PartialType(Seccion)` aplicaría: un DTO por sección con todos sus campos
 * opcionales). Declarar la sección completa como opcional NO bastaría: haría
 * falta enviar TODOS los campos de una sección para cambiar UNO.
 *
 * Campos que el DTO NO acepta (por tanto, 400 con `forbidNonWhitelisted`):
 * `code`, `estado`, `motivoRechazo`, `createdBy`. El primero y el segundo los
 * gestiona la máquina de estados de la parte 4; `createdBy` es inmutable.
 */

/** Sección 1 — identificación y jefatura (parcial). */
export class UpdateIdentificacionDto {
  @IsOptional()
  @IsString({ message: 'titulo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'titulo no puede estar vacío' })
  titulo?: string;

  @IsOptional()
  @IsString({ message: 'jefatura debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'jefatura no puede estar vacía' })
  jefatura?: string;

  @IsOptional()
  @IsInt({ message: 'numeroPlazas debe ser un número entero' })
  @Min(1, { message: 'numeroPlazas debe ser al menos 1' })
  numeroPlazas?: number;

  @IsOptional()
  @IsString({ message: 'ubicacion debe ser una cadena de texto' })
  ubicacion?: string;

  @IsOptional()
  @IsDateString(
    { strictSeparator: true },
    { message: 'fechaRequerida debe ser una fecha válida en formato YYYY-MM-DD' },
  )
  fechaRequerida?: string;
}

/** Sección 2 — perfil profesional (parcial). */
export class UpdatePerfilDto {
  @IsOptional()
  @IsString({ message: 'experienciaRequerida debe ser una cadena de texto' })
  experienciaRequerida?: string;

  @IsOptional()
  @IsString({ message: 'nivelEducacion debe ser una cadena de texto' })
  nivelEducacion?: string;

  @IsOptional()
  @IsString({ message: 'perfilProfesional debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'perfilProfesional no puede estar vacío' })
  perfilProfesional?: string;
}

/** Sección 3 — conocimientos y habilidades (parcial: las listas vienen completas). */
export class UpdateConocimientosDto {
  @IsOptional()
  @IsArray({ message: 'conocimientos debe ser una lista' })
  @ArrayNotEmpty({ message: 'conocimientos no puede estar vacía' })
  @IsString({ each: true, message: 'cada conocimiento debe ser una cadena de texto' })
  conocimientos?: string[];

  @IsOptional()
  @IsArray({ message: 'habilidades debe ser una lista' })
  @ArrayNotEmpty({ message: 'habilidades no puede estar vacía' })
  @IsString({ each: true, message: 'cada habilidad debe ser una cadena de texto' })
  habilidades?: string[];
}

/** Sección 4 — condiciones salariales y contractuales (parcial). */
export class UpdateCondicionesDto {
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

/** Sección 5 — justificación (parcial). */
export class UpdateJustificacionDto {
  @IsOptional()
  @IsString({ message: 'justificacion debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'justificacion no puede estar vacía' })
  justificacion?: string;
}

/**
 * Cuerpo de `PATCH /api/requerimientos/:id`: las 5 secciones, todas opcionales.
 *
 * La validación cruzada del rango salarial se aplica AQUÍ (y no solo en el
 * servicio) para rechazar con 400 un cuerpo que envía `salarioMin > salarioMax`
 * en la misma petición. El caso "solo cambia uno de los dos y el resultado
 * contradice al guardado" lo cubre el servicio al combinar con lo existente.
 */
export class UpdateRequerimientoDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateIdentificacionDto)
  identificacion?: UpdateIdentificacionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePerfilDto)
  perfil?: UpdatePerfilDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateConocimientosDto)
  conocimientos?: UpdateConocimientosDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateCondicionesDto)
  @IsSalarioRangoValido()
  condiciones?: UpdateCondicionesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateJustificacionDto)
  justificacion?: UpdateJustificacionDto;
}
