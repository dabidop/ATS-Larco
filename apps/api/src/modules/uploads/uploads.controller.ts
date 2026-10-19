import { Controller, Get } from '@nestjs/common';

/**
 * Controlador placeholder de uploads (carga de archivos). Sin lógica de
 * negocio: solo andamiaje de la Fase 1.
 */
@Controller('uploads')
export class UploadsController {
  @Get('ping')
  ping() {
    return { modulo: 'uploads', status: 'placeholder' } as const;
  }
}
