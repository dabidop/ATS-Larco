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

/** Nunca registrar query strings: pueden contener correos, búsquedas o tokens. */
function rutaSinQuery(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
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
        // Nunca serializar cabeceras/cuerpo completos: contienen Bearer tokens,
        // cookies y ocasionalmente PII. Los logs deben ser seguros por defecto.
        serializers: {
          req: (request) => ({
            id: request.id,
            method: request.method,
            url: rutaSinQuery(request.url),
            remoteAddress: request.remoteAddress,
          }),
          res: (response) => ({ statusCode: response.statusCode }),
          // No escribir mensajes/cuerpos/stacks de error: pueden contener
          // valores de entrada, SQL o PII. Se conserva solo clasificación.
          err: (error) => ({
            type: error.constructor?.name ?? 'Error',
            name: error.name,
            code: error.code,
          }),
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.set-cookie',
            'req.body.password',
            'req.body.contrasena',
            'req.body.cedula',
            'req.body.telefono',
            'req.body.email',
            'req.body.nombres',
            'req.body.apellidos',
            'req.body.ciudad',
            'req.body.notas',
            'req.body.secret',
            'req.body.token',
            'req.body.refreshToken',
            'err.message',
          ],
          censor: '[REDACTED]',
        },
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
          return requestId && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? requestId : randomUUID();
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
          `${req.method} ${rutaSinQuery(req.url)} ${res.statusCode} ${responseTime} ms`,
        customErrorMessage: (req, res, _err) =>
          `${req.method} ${rutaSinQuery(req.url)} ${res.statusCode} error interno`,
      },
    };
  },
});
