import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

import { ROL_MENSAJE, ROLES_VALIDOS, type RolValido } from './create-usuario.dto';

/**
 * Cuerpo de `PATCH /api/usuarios/:id`.
 *
 * TODO es opcional: se actualiza únicamente lo que viene en el cuerpo. El DTO
 * NO acepta `email` ni `nombre` (la identidad de la cuenta no se edita desde
 * aquí) → 400 con `forbidNonWhitelisted`; tampoco `passwordHash`.
 *
 * `@nestjs/mapped-types` no está instalado, así que este DTO parcial se
 * declara a mano (mismo criterio que `UpdateCandidatoDto`).
 *
 * REGLAS DE NEGOCIO que aplica el SERVICIO (todas con 409/400 en español):
 *  - Sin ningún campo → 400 «Debe indicar al menos un cambio…».
 *  - Desactivarse a sí mismo → 409; cambiarse el propio rol → 409.
 *  - Quitar el rol o desactivar al ÚLTIMO superusuario activo → 409.
 */
export class UpdateUsuarioDto {
  /** `false` desactiva (baja lógica); `true` reactiva. El alta siempre nace en `true`. */
  @IsOptional()
  @IsBoolean({ message: 'activo debe ser un booleano' })
  activo?: boolean;

  @IsOptional()
  @IsString({ message: 'rol debe ser una cadena de texto' })
  @IsIn(ROLES_VALIDOS, { message: ROL_MENSAJE })
  rol?: RolValido;

  /** Se GUARDA hasheado (scrypt); NUNCA se devuelve por la API. */
  @IsOptional()
  @IsString({ message: 'password debe ser una cadena de texto' })
  @MinLength(8, { message: 'password debe tener al menos 8 caracteres' })
  password?: string;

  /**
   * Jefatura del líder (misma regla que en el alta). `''` la VACÍA: un líder
   * vuelve al filtro por `created_by` hasta que IT le asigne área. No es
   * obligatorio: el resto de campos del cuerpo siguen siendo opcionales.
   */
  @IsOptional()
  @IsString({ message: 'jefatura debe ser una cadena de texto' })
  jefatura?: string | null;
}
