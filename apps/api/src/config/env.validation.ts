import { z } from 'zod';

/**
 * Esquema de validación de las variables de entorno de la API (zod).
 *
 * La validación se ejecuta al arrancar (`ConfigModule.forRoot({ validate })`),
 * de modo que una configuración incorrecta detiene el arranque de inmediato
 * con un mensaje claro, en lugar de producir errores crípticos más tarde.
 */

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL debe ser una URL postgres:// o postgresql://'),
  /** Lista CSV de orígenes permitidos por CORS (p. ej. http://localhost:5173,http://localhost:8080). */
  CORS_ORIGIN: z.string().optional(),
  /** Contraseña inicial del usuario admin del seed. Opcional; vacío equivale a ausente. */
  ADMIN_INITIAL_PASSWORD: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== '' ? value : undefined)),
});

/** Tipo de la configuración ya validada. Usar con `ConfigService<Env, true>`. */
export type Env = z.infer<typeof envSchema>;

/**
 * Valida (y normaliza) la configuración cruda.
 * Lanza un Error con todos los problemas encontrados si algo no cumple el esquema.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(global)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${issues}`);
  }
  return result.data;
}

/** Convierte un CSV de orígenes CORS en una lista limpia (sin vacíos). */
export function parseCorsOrigins(csv: string | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}
