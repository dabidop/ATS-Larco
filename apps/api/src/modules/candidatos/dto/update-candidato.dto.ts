import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

import { CEDULA_MENSAJE, CEDULA_PATTERN, LIMITES_CANDIDATO } from './create-candidato.dto';

/**
 * Cuerpo de `PATCH /api/candidatos/:id`.
 *
 * TODO es opcional: se actualiza únicamente lo que viene en el cuerpo. El DTO
 * no acepta `cedulaCifrada`, `telefonoCifrada`, `cedulaHash` ni `createdBy`
 * (gestiona el servicio / es inmutable) → 400 con `forbidNonWhitelisted`.
 *
 * NOTA sobre la cédula: aunque la cédula sea el identificador natural, SÍ se
 * admite editarla. El servicio, al recibirla, la RE-CIFRA y RE-CALCULA su
 * `cedula_hash`; si la nueva cédula colisiona con OTRO candidato responde 409.
 *
 * Etapa 9 (regla 9 de la retroalimentación): los MISMOS límites de longitud y
 * mínimos del DTO de creación (`LIMITES_CANDIDATO`, MinLength 3 en nombres y
 * apellidos) se replican AQUÍ: un PATCH tampoco puede dejar «P» ni «Si» como
 * nombre completo ni notas eternas.
 *
 * `@nestjs/mapped-types` no está instalado, así que este DTO parcial se
 * declara a mano (mismo criterio que `UpdateRequerimientoDto`).
 */
export class UpdateCandidatoDto {
  @IsOptional()
  @IsString({ message: 'nombres debe ser una cadena de texto' })
  @MinLength(3, { message: 'nombres debe tener al menos 3 caracteres' })
  @MaxLength(LIMITES_CANDIDATO.nombres, {
    message: `nombres no puede superar ${LIMITES_CANDIDATO.nombres} caracteres`,
  })
  nombres?: string;

  @IsOptional()
  @IsString({ message: 'apellidos debe ser una cadena de texto' })
  @MinLength(3, { message: 'apellidos debe tener al menos 3 caracteres' })
  @MaxLength(LIMITES_CANDIDATO.apellidos, {
    message: `apellidos no puede superar ${LIMITES_CANDIDATO.apellidos} caracteres`,
  })
  apellidos?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email debe ser un correo electrónico válido' })
  @MaxLength(LIMITES_CANDIDATO.email, {
    message: `email no puede superar ${LIMITES_CANDIDATO.email} caracteres`,
  })
  email?: string;

  /** Editable: el servicio re-cifra y re-hashea. Colisión con otro → 409. */
  @IsOptional()
  @IsString({ message: 'cedula debe ser una cadena de texto' })
  @Matches(CEDULA_PATTERN, { message: CEDULA_MENSAJE })
  cedula?: string;

  @IsOptional()
  @IsString({ message: 'telefono debe ser una cadena de texto' })
  @MaxLength(LIMITES_CANDIDATO.telefono, {
    message: `telefono no puede superar ${LIMITES_CANDIDATO.telefono} caracteres`,
  })
  telefono?: string;

  @IsOptional()
  @IsString({ message: 'ciudad debe ser una cadena de texto' })
  @MaxLength(LIMITES_CANDIDATO.ciudad, {
    message: `ciudad no puede superar ${LIMITES_CANDIDATO.ciudad} caracteres`,
  })
  ciudad?: string;

  /** `null` desasocia al candidato de su área LARCO. */
  @IsOptional()
  @IsUUID('4', { message: 'departamentoId debe ser un UUID válido' })
  departamentoId?: string;

  @IsOptional()
  @IsString({ message: 'cargoActual debe ser una cadena de texto' })
  @MaxLength(LIMITES_CANDIDATO.cargoActual, {
    message: `cargoActual no puede superar ${LIMITES_CANDIDATO.cargoActual} caracteres`,
  })
  cargoActual?: string;

  @IsOptional()
  @IsNumber({}, { message: 'expectativaSalarial debe ser un número' })
  @Min(0, { message: 'expectativaSalarial no puede ser negativa' })
  expectativaSalarial?: number;

  @IsOptional()
  @IsString({ message: 'disponibilidad debe ser una cadena de texto' })
  @MaxLength(LIMITES_CANDIDATO.disponibilidad, {
    message: `disponibilidad no puede superar ${LIMITES_CANDIDATO.disponibilidad} caracteres`,
  })
  disponibilidad?: string;

  @IsOptional()
  @IsString({ message: 'notas debe ser una cadena de texto' })
  @MaxLength(LIMITES_CANDIDATO.notas, {
    message: `notas no puede superar ${LIMITES_CANDIDATO.notas} caracteres`,
  })
  notas?: string;
}
