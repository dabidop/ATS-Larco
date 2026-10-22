import { IsEmail, IsIn, IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Cuerpo de `POST /api/usuarios`.
 *
 * El módulo de usuarios es EXCLUSIVO del `superusuario` (IT, migración 008):
 * RRHH NO gestiona cuentas. Por eso `rol` se valida contra una lista FINITA
 * de códigos (los 4 roles que existen en `roles`), y `password` viaja en
 * CLARO por HTTPS y se GUARDA hasheado con scrypt en el servicio
 * (`common/crypto/password.util.ts`): aquí solo se valida su longitud.
 *
 * Lo que NO aparece aquí —a propósito—:
 *  - `passwordHash`: lo calcula el servicio. El ValidationPipe global
 *    (`whitelist` + `forbidNonWhitelisted`) responde 400 si llega.
 *  - `nombre` en minúsculas ni normalizaciones varias: solo `email` se
 *    normaliza (a minúsculas) en el servicio antes de escribir.
 */

/** Códigos de rol admitidos (los 4 que existen en la tabla `roles`). */
export const ROLES_VALIDOS = [
  'admin_rrhh',
  'analista_seleccion',
  'lider_area',
  'superusuario',
] as const;

/** Código de rol admitido por la API. */
export type RolValido = (typeof ROLES_VALIDOS)[number];

/**
 * Mensaje (en español) para un rol fuera de la lista. Se construye desde la
 * propia lista para que no pueda desincronizarse del `IsIn`.
 */
export const ROL_MENSAJE = `rol debe ser uno de: ${ROLES_VALIDOS.join(', ')}`;

export class CreateUsuarioDto {
  @IsString({ message: 'nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'nombre es obligatorio' })
  nombre!: string;

  @IsEmail({}, { message: 'email debe ser un correo electrónico válido' })
  email!: string;

  @IsString({ message: 'password debe ser una cadena de texto' })
  @MinLength(8, { message: 'password debe tener al menos 8 caracteres' })
  password!: string;

  @IsString({ message: 'rol debe ser una cadena de texto' })
  @IsIn(ROLES_VALIDOS, { message: ROL_MENSAJE })
  rol!: RolValido;
}
