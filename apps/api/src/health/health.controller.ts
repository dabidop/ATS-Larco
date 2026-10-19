import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';

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

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await this.database.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }
}
