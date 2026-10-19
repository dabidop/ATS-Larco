import { Controller, Get } from '@nestjs/common';

/**
 * Controlador placeholder de importación de datos. Sin lógica de negocio:
 * solo andamiaje de la Fase 1.
 */
@Controller('importacion')
export class ImportacionController {
  @Get('ping')
  ping() {
    return { modulo: 'importacion', status: 'placeholder' } as const;
  }
}
