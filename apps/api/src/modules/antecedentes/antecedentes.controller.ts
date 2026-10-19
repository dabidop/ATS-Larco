import { Controller, Get } from '@nestjs/common';

/**
 * Controlador placeholder de antecedentes. Sin lógica de negocio:
 * solo andamiaje de la Fase 1.
 */
@Controller('antecedentes')
export class AntecedentesController {
  @Get('ping')
  ping() {
    return { modulo: 'antecedentes', status: 'placeholder' } as const;
  }
}
