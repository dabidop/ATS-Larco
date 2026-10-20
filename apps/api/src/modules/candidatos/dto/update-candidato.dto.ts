import { IsEmail, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

import { CEDULA_MENSAJE, CEDULA_PATTERN } from './create-candidato.dto';

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
 * `@nestjs/mapped-types` no está instalado, así que este DTO parcial se
 * declara a mano (mismo criterio que `UpdateRequerimientoDto`).
 */
export class UpdateCandidatoDto {
  @IsOptional()
  @IsString({ message: 'nombres debe ser una cadena de texto' })
  nombres?: string;

  @IsOptional()
  @IsString({ message: 'apellidos debe ser una cadena de texto' })
  apellidos?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email debe ser un correo electrónico válido' })
  email?: string;

  /** Editable: el servicio re-cifra y re-hashea. Colisión con otro → 409. */
  @IsOptional()
  @IsString({ message: 'cedula debe ser una cadena de texto' })
  @Matches(CEDULA_PATTERN, { message: CEDULA_MENSAJE })
  cedula?: string;

  @IsOptional()
  @IsString({ message: 'telefono debe ser una cadena de texto' })
  telefono?: string;

  @IsOptional()
  @IsString({ message: 'ciudad debe ser una cadena de texto' })
  ciudad?: string;

  @IsOptional()
  @IsString({ message: 'cargoActual debe ser una cadena de texto' })
  cargoActual?: string;

  @IsOptional()
  @IsNumber({}, { message: 'expectativaSalarial debe ser un número' })
  @Min(0, { message: 'expectativaSalarial no puede ser negativa' })
  expectativaSalarial?: number;

  @IsOptional()
  @IsString({ message: 'disponibilidad debe ser una cadena de texto' })
  disponibilidad?: string;

  @IsOptional()
  @IsString({ message: 'notas debe ser una cadena de texto' })
  notas?: string;
}
