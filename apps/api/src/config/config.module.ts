import { resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './env.validation';

/**
 * Archivos .env candidatos, en orden de prioridad:
 *  1. `apps/api/.env` (si el proceso se lanza desde el paquete de la API).
 *  2. `../../.env` → .env de la raíz del monorepo (caso habitual con pnpm).
 *
 * Los valores ya presentes en `process.env` siempre tienen prioridad sobre
 * los archivos (comportamiento por defecto de @nestjs/config).
 */
export const ENV_FILE_PATHS = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
];

/**
 * Módulo global de configuración validada con zod (`validateEnv`).
 * Si la configuración es inválida, el arranque falla aquí mismo con un
 * mensaje que lista cada variable problemática.
 */
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  validate: validateEnv,
  envFilePath: ENV_FILE_PATHS,
});
