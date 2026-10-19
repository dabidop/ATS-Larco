import { Controller, Get } from '@nestjs/common';

/**
 * Controlador placeholder del proveedor externo (agencias). Sin lógica de
 * negocio: solo andamiaje de la Fase 1.
 */
@Controller('proveedor')
export class ProveedorController {
  @Get('ping')
  ping() {
    return { modulo: 'proveedor', status: 'placeholder' } as const;
  }
}
