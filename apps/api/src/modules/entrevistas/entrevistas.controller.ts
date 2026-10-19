import { Controller, Get } from '@nestjs/common';

/**
 * Controlador placeholder de entrevistas. Sin lógica de negocio:
 * solo andamiaje de la Fase 1.
 */
@Controller('entrevistas')
export class EntrevistasController {
  @Get('ping')
  ping() {
    return { modulo: 'entrevistas', status: 'placeholder' } as const;
  }
}
