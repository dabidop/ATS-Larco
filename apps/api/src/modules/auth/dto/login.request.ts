import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Cuerpo de `POST /api/auth/login`.
 *
 * El ValidationPipe global (`whitelist` + `forbidNonWhitelisted`) elimina los
 * campos no declarados y responde 400 ante cualquier campo extra o inválido.
 */
export class LoginRequestDto {
  @IsEmail({}, { message: 'email debe ser una dirección de correo válida' })
  email!: string;

  @IsString({ message: 'password debe ser una cadena de texto' })
  @MinLength(1, { message: 'password no puede estar vacía' })
  password!: string;
}
