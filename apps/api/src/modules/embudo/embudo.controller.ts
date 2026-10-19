import { Controller, Get } from '@nestjs/common';

/**
 * Controlador placeholder del embudo de selección (pipeline). Sin lógica
 * de negocio: solo andamiaje de la Fase 1.
 */
@Controller('embudo')
export class EmbudoController {
  @Get('ping')
  ping() {
    return { modulo: 'embudo', status: 'placeholder' } as const;
  }
}
