import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../common/decorators/public.decorator';
import { DatabaseService } from '../database/database.service';

/** Respuesta del endpoint de salud. */
export interface HealthResponse {
  status: 'ok' | 'error';
  module: 'api';
  db: 'up' | 'down';
  timestamp: string;
  uptimeS: number;
}

/**
 * Salud de la aplicación: comprueba que el pool de PostgreSQL responde
 * (`SELECT 1`). 200 si la base de datos está arriba, 503 si no.
 */
@Controller()
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  /**
   * `GET /api/health` — ruta PÚBLICA (monitorización/sondeos sin credenciales).
   * Devuelve 200 si PostgreSQL responde y 503 si no.
   */
  @Public()
  @Get('health')
  async health(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const db = await this.checkDatabase();

    if (db === 'down') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: db === 'up' ? 'ok' : 'error',
      module: 'api',
      db,
      timestamp: new Date().toISOString(),
      uptimeS: Number(process.uptime().toFixed(1)),
    };
  }

  /** Liveness: el proceso está vivo; no depende de PostgreSQL. */
  @Public()
  @Get('health/live')
  live(): { status: 'ok'; module: 'api'; timestamp: string } {
    return { status: 'ok', module: 'api', timestamp: new Date().toISOString() };
  }

  /** Readiness: alias explícito para balanceadores y orquestadores. */
  @Public()
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    return this.health(response);
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await this.database.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }
}
