import { Controller, Get } from '@nestjs/common';

/**
 * Controlador placeholder de requerimientos de personal. Sin lógica de
 * negocio: solo andamiaje de la Fase 1.
 */
@Controller('requerimientos')
export class RequerimientosController {
  @Get('ping')
  ping() {
    return { modulo: 'requerimientos', status: 'placeholder' } as const;
  }
}
