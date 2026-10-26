import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

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

/**
 * Límites de longitud por campo (regla 9 de la retroalimentación, Etapa 9):
 * «los campos deben validar cantidad de caracteres». Compartidos por el DTO de
 * creación y el de actualización; el FRONTEND replica estos MISMOS números.
 */
export const LIMITES_CANDIDATO = {
  nombres: 100,
  apellidos: 100,
  email: 254,
  telefono: 20,
  ciudad: 80,
  cargoActual: 120,
  disponibilidad: 120,
  notas: 2000,
} as const;

export class CreateCandidatoDto {
  @IsString({ message: 'nombres debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'nombres es obligatorio' })
  @MinLength(3, { message: 'nombres debe tener al menos 3 caracteres' })
  @MaxLength(LIMITES_CANDIDATO.nombres, {
    message: `nombres no puede superar ${LIMITES_CANDIDATO.nombres} caracteres`,
  })
  nombres!: string;

  @IsString({ message: 'apellidos debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'apellidos es obligatorio' })
  @MinLength(3, { message: 'apellidos debe tener al menos 3 caracteres' })
  @MaxLength(LIMITES_CANDIDATO.apellidos, {
    message: `apellidos no puede superar ${LIMITES_CANDIDATO.apellidos} caracteres`,
  })
  apellidos!: string;

  /** Opcional, pero si viene debe ser un correo válido (único en BD). */
  @IsOptional()
  @IsEmail({}, { message: 'email debe ser un correo electrónico válido' })
  @MaxLength(LIMITES_CANDIDATO.email, {
    message: `email no puede superar ${LIMITES_CANDIDATO.email} caracteres`,
  })
  email?: string;

  /** PII: se cifra y se hashea en el servicio; aquí solo se valida el formato. */
  @IsString({ message: 'cedula debe ser una cadena de texto' })
  @Matches(CEDULA_PATTERN, { message: CEDULA_MENSAJE })
  cedula!: string;

  /** PII: opcional; se cifra en el servicio (vacío → sin teléfono). */
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

  /** Área LARCO del candidato (Etapa 9; FK a `departamentos`; opcional). */
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
