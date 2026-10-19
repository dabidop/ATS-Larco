import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { parseCorsOrigins, type Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  // bufferLogs: los logs del arranque quedan en cola hasta `useLogger`.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('api');

  const allowedOrigins = parseCorsOrigins(config.get('CORS_ORIGIN', ''));
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
