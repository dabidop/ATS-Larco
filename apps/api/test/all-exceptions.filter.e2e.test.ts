import './helpers/test-env';
import { BadRequestException, Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { Public } from '../src/common/decorators/public.decorator';
import { DatabaseService } from '../src/database/database.service';

/**
 * Ruta de prueba que lanza un error interno (no HTTP). Es `@Public()` para
 * que el AuthGuard global no la tape: aquí se prueba el FORMATO de las
 * respuestas de error, no la autenticación (eso lo cubre guards.e2e.test.ts).
 */
@Public()
@Controller('test-errors')
class ErrorTestController {
  @Get('boom')
  boom(): never {
    throw new Error('fallo interno confidencial-xyz-123');
  }

  @Get('invalido')
  invalido(): never {
    throw new BadRequestException('El campo nombre es obligatorio');
  }
}

@Module({ controllers: [ErrorTestController] })
class ErrorTestModule {}

function createFakeDatabase(): DatabaseService {
  return {
    pool: {} as Pool,
    query: async () => ({ rows: [{ ok: 1 }] }),
    onModuleDestroy: async () => {},
  } as unknown as DatabaseService;
}

describe('AllExceptionsFilter (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, ErrorTestModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(createFakeDatabase())
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('ruta inexistente → 404 con el formato JSON estándar', async () => {
    const response = await request(app.getHttpServer()).get('/api/ruta-que-no-existe').expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: '/api/ruta-que-no-existe',
    });
    expect(typeof response.body.message).toBe('string');
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('HttpException de cliente → conserva mensaje y código', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/test-errors/invalido')
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      message: 'El campo nombre es obligatorio',
      error: 'Bad Request',
      timestamp: expect.any(String),
      path: '/api/test-errors/invalido',
    });
  });

  it('error interno → 500 genérico sin filtrar detalles', async () => {
    const response = await request(app.getHttpServer()).get('/api/test-errors/boom').expect(500);

    expect(response.body).toMatchObject({
      statusCode: 500,
      message: 'Error interno del servidor',
      error: 'Internal Server Error',
      path: '/api/test-errors/boom',
    });
    expect(typeof response.body.timestamp).toBe('string');
    // Nunca se filtra el detalle del fallo al cliente.
    expect(JSON.stringify(response.body)).not.toContain('confidencial');
  });
});
