import { Controller, Get } from '@nestjs/common';

/**
 * Controlador placeholder de autenticación. Sin lógica de negocio:
 * solo andamiaje de la Fase 1.
 */
@Controller('auth')
export class AuthController {
  @Get('ping')
  ping() {
    return { modulo: 'auth', status: 'placeholder' } as const;
  }
}
