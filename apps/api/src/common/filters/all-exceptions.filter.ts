import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';

/** Cuerpo JSON siempre igual para cualquier error HTTP de la API. */
export interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error?: string;
  timestamp: string;
  path: string;
}

/**
 * Filtro global de excepciones.
 *
 * Toda respuesta de error sale con el MISMO formato JSON:
 *   `{ statusCode, message, error?, timestamp, path }`
 *
 * Los errores internos (no HTTP) se responden con un mensaje genérico: nunca
 * se filtran al cliente detalles del fallo (stack, SQL, credenciales, etc.).
 * El detalle completo sí se registra en los logs del servidor.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const { statusCode, message, error } = this.toHttpError(exception);
    const path = request.url ?? request.originalUrl ?? request.path ?? 'unknown';

    if (statusCode >= 500) {
      this.logger.error(
        { err: exception, method: request.method, path },
        'Error interno no controlado',
        'AllExceptionsFilter',
      );
    } else {
      this.logger.warn(
        { method: request.method, path, statusCode },
        `Respuesta con error ${statusCode}`,
        'AllExceptionsFilter',
      );
    }

    const body: ErrorResponseBody = {
      statusCode,
      message,
      ...(error !== undefined ? { error } : {}),
      timestamp: new Date().toISOString(),
      path,
    };

    response.status(statusCode).json(body);
  }

  private toHttpError(exception: unknown): {
    statusCode: number;
    message: string | string[];
    error?: string;
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const raw = exception.getResponse();

      if (typeof raw === 'string') {
        return { statusCode, message: raw, error: exception.name };
      }

      if (typeof raw === 'object' && raw !== null) {
        const body = raw as Record<string, unknown>;
        const message =
          typeof body.message === 'string' || Array.isArray(body.message)
            ? (body.message as string[])
            : exception.message;
        const error = typeof body.error === 'string' ? body.error : exception.name;
        return { statusCode, message, error };
      }

      return { statusCode, message: exception.message, error: exception.name };
    }

    // Errores no HTTP (programación, base de datos, dependencias externas...):
    // mensaje genérico, sin exponer nada interno al cliente.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Error interno del servidor',
      error: 'Internal Server Error',
    };
  }
}
