import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { parseCorsOrigins, type Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  // bufferLogs: los logs del arranque quedan en cola hasta `useLogger`.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  // Cabeceras de seguridad HTTP (helmet@8, defaults): CSP, HSTS, X-Frame-Options,
  // X-Content-Type-Options, Referrer-Policy, COOP/CORP… y elimina X-Powered-By.
  // Se aplica lo antes posible en el bootstrap, antes del prefix y de CORS.
  app.use(helmet());

  // Caché HTTP desactivada en la API: las respuestas son por-USUARIO (JWT) y
  // Express emite ETag por defecto, lo que provoca `304 Not Modified` SIN
  // cuerpo cuando un navegador revalida una GET repetida (p. ej. reconsultar
  // el listado tras crear un registro): `fetch` recibe un cuerpo vacío y la
  // UI pinta «sin datos» sin ningún error visible. Una API autenticada no
  // debe ser cacheable por navegadores ni por proxies intermedios (bug
  // hallado y corregido en la Etapa 8C, verificado con If-None-Match).
  app.getHttpAdapter().getInstance().set('etag', false);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.setGlobalPrefix('api');

  // Validación global de DTOs (class-validator): solo se aceptan los campos
  // declarados (whitelist + forbidNonWhitelisted → 400 si hay campos extra) y
  // el cuerpo se transforma a los tipos del DTO (transform).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const allowedOrigins = parseCorsOrigins(config.get('CORS_ORIGIN', ''));
  // CORS: lista blanca explícita desde CORS_ORIGIN (sin orígenes → deshabilitado).
  // Futuro (sin cambio hoy): valorar restringir `credentials` si algún origen no lo necesita.
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  });

  // nestjs-pino pasa a ser el logger real de la aplicación (también para los
  // logs internos de Nest) y descarga los logs bufferizados del arranque.
  app.useLogger(app.get(Logger));

  const port = config.getOrThrow('PORT');
  await app.listen(port);
  app.get(Logger).log(`API escuchando en http://localhost:${port}/api/health`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Fallo de arranque (p. ej. configuración inválida): se reporta y se sale.
  console.error('[api] No se pudo iniciar la API:', error);
  process.exitCode = 1;
});
