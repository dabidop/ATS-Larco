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
  /** Correo del administrador inicial; configurable por ambiente. */
  ADMIN_INITIAL_EMAIL: z.string().email().default('admin@larco.co'),
  /** Nombre del administrador inicial; configurable por ambiente. */
  ADMIN_INITIAL_NAME: z.string().min(3).default('Administrador RRHH'),
  /** Correo del superusuario inicial; configurable por ambiente. */
  SUPER_INITIAL_EMAIL: z.string().email().default('it@larco.co'),
  /** Nombre del superusuario inicial; configurable por ambiente. */
  SUPER_INITIAL_NAME: z.string().min(3).default('Superusuario IT'),
  /** Solo se usa al ejecutar la migración 008 de bootstrap. */
  SUPER_INITIAL_PASSWORD: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== '' ? value : undefined)),
  /**
   * Secreto para firmar los JWT. Obligatorio y mínimo 32 caracteres.
   * Un valor vacío se trata como AUSENTE y produce un error claro en el arranque.
   */
  JWT_SECRET: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string({ error: 'JWT_SECRET es requerido (no puede quedar vacío)' })
      .min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  ),
  /**
   * Vigencia del access token en horas (entero entre 1 y 72).
   * Vacío o ausente → 24 h por defecto.
   */
  JWT_TTL_HOURS: z.preprocess(
    (value) => (value === undefined || value === null || value === '' ? undefined : value),
    z.coerce
      .number({ error: 'JWT_TTL_HOURS debe ser un número entre 1 y 72' })
      .int('JWT_TTL_HOURS debe ser un entero entre 1 y 72')
      .min(1, 'JWT_TTL_HOURS debe estar entre 1 y 72')
      .max(72, 'JWT_TTL_HOURS debe estar entre 1 y 72')
      .default(24),
  ),
  /**
   * Clave de cifrado AES-256-CBC para PII: 32 bytes exactos en base64.
   * Obligatoria; un valor vacío se trata como AUSENTE y detiene el arranque
   * con un mensaje claro (Fase 2, parte 3).
   */
  CRYPTO_KEY_BASE64: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string({ error: 'CRYPTO_KEY_BASE64 es requerida (32 bytes en base64)' })
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'CRYPTO_KEY_BASE64 debe decodificar a exactamente 32 bytes en base64',
      ),
  ),
  /**
   * Clave anterior para la rotación planificada (opcional): al rotar, la
   * vigente pasa aquí y se emite una nueva arriba. Si existe, también debe
   * ser de exactamente 32 bytes en base64. Vacío → ausente.
   */
  CRYPTO_KEY_PREVIOUS_BASE64: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'CRYPTO_KEY_PREVIOUS_BASE64 debe decodificar a exactamente 32 bytes en base64 (o quedar ausente)',
      )
      .optional(),
  ),
  /**
   * Clave HMAC-SHA-256 para el HASH DE BÚSQUEDA de cédulas (Fase 4, parte 1):
   * 32 bytes en base64. Es DEDICADA y NO debe rotarse junto a `CRYPTO_KEY_*`:
   * si se rota, hay que recalcular todos los `cedula_hash` guardados.
   *
   * Declarada OPCIONAL en zod para no romper la validación aislada de las
   * llaves CRYPTO_* que hacen los tests (`crypto.e2e.test.ts` llama a
   * `validateEnv` con un objeto mínimo que no la incluye). En tiempo de
   * ejecución es OBLIGATORIA: `SearchHashService` la valida y detiene el
   * arranque con un mensaje claro si falta. Vacío → ausente.
   */
  CEDULA_SEARCH_KEY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'CEDULA_SEARCH_KEY debe decodificar a exactamente 32 bytes en base64 (o quedar ausente)',
      )
      .optional(),
  ),
  /**
   * Directorio donde la API escribe los archivos subidos (Fase 4, parte 2:
   * uploads). Relativo al CWD en local (`data/uploads`) y absoluto dentro del
   * contenedor (`/app/data/uploads`, fijado por docker-compose). Vacío o
   * ausente → `data/uploads` por defecto.
   */
  UPLOAD_DIR: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1, 'UPLOAD_DIR no puede estar vacío').default('data/uploads'),
  ),
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
  const data = result.data;
  if (data.NODE_ENV === 'production') {
    const errores: string[] = [];
    if (!data.CORS_ORIGIN || parseCorsOrigins(data.CORS_ORIGIN).length === 0) {
      errores.push('CORS_ORIGIN es obligatorio en producción');
    }
    if (data.ADMIN_INITIAL_EMAIL === 'admin@larco.co') {
      errores.push('ADMIN_INITIAL_EMAIL debe parametrizarse en producción');
    }
    if (data.SUPER_INITIAL_EMAIL === 'it@larco.co') {
      errores.push('SUPER_INITIAL_EMAIL debe parametrizarse en producción');
    }
    if (errores.length > 0) {
      throw new Error(
        `Configuración de entorno inválida:\n${errores.map((e) => `  - ${e}`).join('\n')}`,
      );
    }
  }
  return data;
}

/** Convierte un CSV de orígenes CORS en una lista limpia (sin vacíos). */
export function parseCorsOrigins(csv: string | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}
