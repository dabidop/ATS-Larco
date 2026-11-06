/**
 * Entorno sintético para las suites que prueban sesiones reales contra PG.
 * Se mantiene separado del entorno `test` porque AuthGuard debe consultar
 * `auth_sessions`, rol y estado activo en cada petición.
 */
process.env.NODE_ENV = 'production';
process.env.PORT ??= '3000';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.JWT_SECRET ??= 'test-jwt-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_TTL_HOURS ??= '24';
process.env.ACCESS_TOKEN_TTL_MINUTES = '60';
process.env.ADMIN_INITIAL_EMAIL = 'ats-admin@synthetic.test';
process.env.SUPER_INITIAL_EMAIL = 'ats-it@synthetic.test';
process.env.CRYPTO_KEY_BASE64 ??= Buffer.alloc(32, 7).toString('base64');
process.env.CEDULA_SEARCH_KEY ??= Buffer.alloc(32, 11).toString('base64');
process.env.UPLOAD_DIR ??= 'data/uploads-test';

export {};
