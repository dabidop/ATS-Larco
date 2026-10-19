import { Controller, Get } from '@nestjs/common';

/**
 * Controlador placeholder de candidatos. Sin lógica de negocio:
 * solo andamiaje de la Fase 1.
 */
@Controller('candidatos')
export class CandidatosController {
  @Get('ping')
  ping() {
    return { modulo: 'candidatos', status: 'placeholder' } as const;
  }
}
