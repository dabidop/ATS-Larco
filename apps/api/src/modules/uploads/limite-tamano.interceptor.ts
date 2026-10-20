import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { catchError, throwError } from 'rxjs';
import type { Observable } from 'rxjs';

/**
 * Mensaje claro (en español) del 413 de subida.
 * El texto por defecto de Multer/Nest sería «File too large».
 */
const MENSAJE_LIMITE = 'El archivo supera el tamaño máximo permitido (5 MB)';

/** Códigos que Multer usa para sus errores (no son `HttpException`). */
interface ErrorDeMulter {
  code?: string;
}

/**
 * ¿El error es un `LIMIT_FILE_SIZE` de Multer (o el `PayloadTooLargeException`
 * en el que Nest ya lo ha convertido)?
 *
 * Se comprueban LAS DOS formas a propósito: `transformException` de
 * `@nestjs/platform-express` traduce `LIMIT_FILE_SIZE` a
 * `PayloadTooLargeException` (413), pero si esa traducción cambiara o el error
 * llegara sin transformar, el `code` crudo sigue ahí y este interceptor
 * garantiza un 413 en lugar de un 500.
 */
function esLimiteDeTamano(error: unknown): boolean {
  if (error instanceof PayloadTooLargeException) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return (error as ErrorDeMulter).code === 'LIMIT_FILE_SIZE';
}

/**
 * Interceptor de RUTA que traduce el «archivo demasiado grande» de Multer a un
 * `413` con mensaje en español.
 *
 * Por qué un interceptor y no un `try/catch` dentro del controlador: el límite
 * lo aplica `FileInterceptor` al PARSEAR el multipart, es decir, ANTES de que
 * se ejecute el manejador de la ruta —un `try/catch` del manejador nunca lo
 * vería—. Declarado PRIMERO en `@UseInterceptors(...)`, este interceptor envuelve
 * al `FileInterceptor` (Nest encadena los interceptores en orden: el primero es
 * el más externo) y puede interceptar su error.
 *
 * Cualquier OTRO error (400/403/404/409 del propio controlador, fallos de BD…)
 * se PROPAGA SIN TOCAR: sigue llegando al `AllExceptionsFilter` global con su
 * formato `{ statusCode, message, error?, timestamp, path }`.
 */
@Injectable()
export class LimiteTamanoInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          throwError(() =>
            esLimiteDeTamano(error) ? new PayloadTooLargeException(MENSAJE_LIMITE) : error,
          ),
        ),
      );
  }
}
