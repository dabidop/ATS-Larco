import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

/**
 * Cuerpo de `POST /api/candidatos`.
 *
 * La PII sensible viaja en CLARO en la petición (así la recibe el servidor) y
 * se CIFRA aquí dentro antes de tocar la BD: el servicio guarda
 * `cedula_cifrada`/`telefono_cifrada` (AES-256-CBC) y `cedula_hash` (HMAC de
 * búsqueda). Nada de esto se ve en el DTO: el cliente solo habla en claro.
 *
 * Lo que NO aparece aquí —a propósito—:
 *  - `cedulaCifrada`, `telefonoCifrada`, `cedulaHash`: los calcula el servicio.
 *  - `createdBy`: lo toma el controlador del JWT (`request.user.sub`).
 * El ValidationPipe global (`whitelist` + `forbidNonWhitelisted`) responde 400
 * si el cliente envía alguno de esos campos.
 */

/** Formato de cédula admitido: de 6 a 10 dígitos, SIN puntos ni guiones. */
export const CEDULA_PATTERN = /^\d{6,10}$/;

/** Mensaje (en español) para una cédula que no cumple el patrón. */
export const CEDULA_MENSAJE =
  'cedula debe ser una cédula válida: de 6 a 10 dígitos, sin puntos ni guiones';

export class CreateCandidatoDto {
  @IsString({ message: 'nombres debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'nombres es obligatorio' })
  nombres!: string;

  @IsString({ message: 'apellidos debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'apellidos es obligatorio' })
  apellidos!: string;

  /** Opcional, pero si viene debe ser un correo válido (único en BD). */
  @IsOptional()
  @IsEmail({}, { message: 'email debe ser un correo electrónico válido' })
  email?: string;

  /** PII: se cifra y se hashea en el servicio; aquí solo se valida el formato. */
  @IsString({ message: 'cedula debe ser una cadena de texto' })
  @Matches(CEDULA_PATTERN, { message: CEDULA_MENSAJE })
  cedula!: string;

  /** PII: opcional; se cifra en el servicio (vacío → sin teléfono). */
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
