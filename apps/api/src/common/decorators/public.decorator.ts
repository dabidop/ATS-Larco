import { SetMetadata } from '@nestjs/common';

/** Clave de metadatos que marca una ruta como pública (sin autenticación). */
export const IS_PUBLIC_KEY = 'esRutaPublica';

/**
 * Marca un controlador o handler como ruta PÚBLICA: el AuthGuard global no
 * exige token para acceder a él (p. ej. `GET /api/health` o
 * `POST /api/auth/login`). Todo lo demás está autenticado por defecto.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
