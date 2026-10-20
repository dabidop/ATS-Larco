/**
 * Variables de entorno mínimas para los tests e2e.
 *
 * IMPORTANTE: este archivo debe importarse ANTES que `../../src/app.module`
 * (los imports de ESM se evalúan en orden de aparición). La validación con
 * zod se ejecuta al evaluar `AppConfigModule`, es decir, en el momento en que
 * se carga el módulo de la app, así que las variables tienen que existir ya.
 *
 * Se usa `??=` para respetar cualquier valor que ya haya definido quien lance
 * los tests. Ningún valor apunta a una base de datos real: los tests inyectan
 * un doble de `DatabaseService`.
 */
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3000';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5555/ats_test';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
// Clave de firma JWT solo para tests (la validación zod la exige, ≥ 32 chars)
// y TTL de 24 h para poder asertar expiresIn = 86400 de forma estable.
process.env.JWT_SECRET ??= 'test-jwt-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_TTL_HOURS ??= '24';
// Clave de cifrado PII solo para tests (la validación zod la exige: 32 bytes
// en base64). Determinista para que los tests sean reproducibles; NUNCA
// usar fuera de tests. CRYPTO_KEY_PREVIOUS_BASE64 queda ausente a propósito.
process.env.CRYPTO_KEY_BASE64 ??= Buffer.alloc(32, 7).toString('base64');
// Clave HMAC del hash de búsqueda de cédulas (Fase 4, parte 1): 32 bytes en
// base64, determinista y solo para tests (igual que CRYPTO_KEY_BASE64).
process.env.CEDULA_SEARCH_KEY ??= Buffer.alloc(32, 11).toString('base64');
// Directorio de subidas (Fase 4, parte 2): los tests SÍ escriben archivos, pero
// NUNCA en el directorio de DESARROLLO. Motivo: `dev-db-env` carga el `.env`
// raíz, que fija `UPLOAD_DIR=data/uploads` (el directorio real de la API); sin
// esta redirección los e2e de uploads dejarían restos en el de desarrollo.
// Un valor fijado EXTERNAMENTE por quien lance los tests y distinto del de
// desarrollo se respeta (filosofía `??=` del resto de este fichero).
const subidas = process.env.UPLOAD_DIR;
process.env.UPLOAD_DIR =
  subidas === undefined || subidas === 'data/uploads' ? 'data/uploads-test' : subidas;

export {};
