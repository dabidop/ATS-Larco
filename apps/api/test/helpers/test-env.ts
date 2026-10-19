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

export {};
