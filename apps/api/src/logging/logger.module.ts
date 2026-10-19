import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import type { Env } from '../config/env.validation';

/**
 * Resuelve la ruta absoluta de `pino-pretty`. Con pnpm, pino no siempre puede
 * resolver el transporte por nombre desde su propio contexto, así que se pasa
 * la ruta absoluta. Solo se ejecuta en development (pino-pretty es una
 * dependencia de desarrollo y en producción no está instalada).
 */
function resolvePinoPrettyTarget(): string {
  return createRequire(__filename).resolve('pino-pretty');
}

/**
 * Logging estructurado con nestjs-pino (pino + pino-http).
 *
 * - Cada request genera un log con método, url, status code y duración (ms).
 * - Se reutiliza el header `x-request-id` como `reqId` (correlación con el
 *   front u otros servicios); si no viene, se genera un UUID nuevo.
 * - `pino-pretty` SOLO se usa en development. Es una dependencia de desarrollo,
 *   por eso el transporte se declara condicionalmente: en test/production los
 *   logs son JSON puro y pino-pretty nunca se carga.
 * - En test el nivel es `error` para mantener la salida limpia.
 */
export const AppLoggerModule = LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => {
    const nodeEnv = config.getOrThrow('NODE_ENV');
    const isDevelopment = nodeEnv === 'development';
    const isTest = nodeEnv === 'test';

    return {
      pinoHttp: {
        level: isTest ? 'error' : 'info',
        ...(isDevelopment
          ? {
              transport: {
                target: resolvePinoPrettyTarget(),
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss',
                  ignore: 'pid,hostname',
                },
              },
            }
          : {}),
        genReqId: (req) => {
          const header = req.headers['x-request-id'];
          const requestId = Array.isArray(header) ? header[0] : header;
          return requestId && requestId.trim() !== '' ? requestId : randomUUID();
        },
        // Nivel según la severidad: 5xx (o error de socket) → error, 4xx → warn.
        customLogLevel: (_req, res, err) => {
          if (err !== undefined || res.statusCode >= 500) {
            return 'error';
          }
          if (res.statusCode >= 400) {
            return 'warn';
          }
          return 'info';
        },
        customSuccessMessage: (req, res, responseTime) =>
          `${req.method} ${req.url} ${res.statusCode} ${responseTime} ms`,
        customErrorMessage: (req, res, err) =>
          `${req.method} ${req.url} ${res.statusCode} ${err.message}`,
      },
    };
  },
});
