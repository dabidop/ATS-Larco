import { config as cargarDotenv } from 'dotenv';

/**
 * Carga el `.env` de la RAÍZ del monorepo —el mismo que usan los scripts
 * `db:migrate` de `@ats/api` con `node --env-file-if-exists=../../.env`— para
 * que los tests que SÍ necesitan la BD dev de docker encuentren su
 * `DATABASE_URL` (postgres://…@localhost:5432/ats_dev).
 *
 * Orden IMPORTANTE: debe importarse ANTES que `./test-env` (los imports de
 * ESM se evalúan en orden de aparición). `test-env` fija `DATABASE_URL` con
 * `??=` y NO pisa un valor ya cargado; a la inversa, dotenv con
 * `override: false` NO pisa un `DATABASE_URL` definido externamente, así que
 * quien lance los tests siempre puede apuntar a otra base.
 *
 * La ruta `../../.env` se resuelve respecto al CWD de trabajo del paquete
 * (`apps/api`, igual que en los scripts `db:migrate` de su package.json).
 */
cargarDotenv({ path: '../../.env', override: false });

export {};
