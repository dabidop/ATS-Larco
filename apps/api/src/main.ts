import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { parseCorsOrigins, type Env } from './config/env.validation';
import { DatabaseService } from './database/database.service';

/** Solo aceptamos IDs de correlación cortos y seguros para evitar log injection. */
function requestIdSeguro(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    return undefined;
  }
  return value;
}

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
    const incoming = requestIdSeguro(_req.headers['x-request-id']);
    const requestId = incoming ?? randomUUID();
    _req.headers['x-request-id'] = requestId;
    res.set('X-Request-Id', requestId);
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

  // Integridad RBAC: avisa en el arranque si la BD se quedó sin ningún
  // superusuario activo (ver `avisarSiNoHaySuperusuario`).
  await avisarSiNoHaySuperusuario(app);

  const port = config.getOrThrow('PORT');
  await app.listen(port);
  app.get(Logger).log(`API escuchando en http://localhost:${port}/api/health`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Fallo de arranque (p. ej. configuración inválida): se reporta y se sale.
  console.error('[api] No se pudo iniciar la API:', error);
  process.exitCode = 1;
});

/**
 * Comprueba al arrancar que existe al menos un `superusuario` ACTIVO.
 *
 * Por qué: si el rol se pierde en BD (p. ej. una edición manual, o un `down`
 * accidental), el sistema entra en un bloqueo del que no se sale por la
 * interfaz — `UsuariosService` impide quitar el rol al ÚLTIMO superusuario,
 * así que ya no queda nadie que pueda repararlo desde `/usuarios`. El síntoma
 * es confuso: `it@larco.co` inicia sesión, pero el menú oculta «Bitácora» y
 * «Usuarios» y la API responde 403.
 *
 * No es fatal (un despliegue debe seguir sirviendo negocio), pero deja un
 * ERROR en el log del arranque con la reparación exacta.
 */
async function avisarSiNoHaySuperusuario(app: INestApplication): Promise<void> {
  try {
    const database = app.get(DatabaseService, { strict: false });
    const { rows } = await database.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE r.code = 'superusuario' AND u.active`,
    );
    if ((rows[0]?.total ?? 0) > 0) return;

    app
      .get(Logger)
      .error(
        [
          'No hay NINGÚN superusuario (IT) activo: la Bitácora y la gestión de',
          'usuarios quedan inaccesibles y no se pueden recuperar desde la UI.',
          'Reparación: pnpm --filter @ats/api db:migrate (migración 016) o',
          "UPDATE users SET role_id=(SELECT id FROM roles WHERE code='superusuario')",
          " WHERE email='it@larco.co';",
        ].join(' '),
        'RbacIntegridad',
      );
  } catch (error) {
    // La comprobación es diagnóstica: nunca debe impedir el arranque.
    app
      .get(Logger)
      .warn(
        `No se pudo verificar que exista un superusuario activo: ${String(error)}`,
        'RbacIntegridad',
      );
  }
}
