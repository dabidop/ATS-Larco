import { Controller, Get } from '@nestjs/common';

/**
 * Controlador placeholder del historial. Sin lógica de negocio:
 * solo andamiaje de la Fase 1.
 */
@Controller('historial')
export class HistorialController {
  @Get('ping')
  ping() {
    return { modulo: 'historial', status: 'placeholder' } as const;
  }
}
