import { Controller, Get } from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Controlador placeholder de importación de datos. Sin lógica de negocio:
 * solo andamiaje de la Fase 1.
 *
 * RBAC: solo `admin_rrhh` y `analista_seleccion` (los demás reciben 403).
 */
@Controller('importacion')
export class ImportacionController {
  @Roles('admin_rrhh', 'analista_seleccion')
  @Get('ping')
  ping() {
    return { modulo: 'importacion', status: 'placeholder' } as const;
  }
}
