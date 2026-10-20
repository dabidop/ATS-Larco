import { Controller, Get } from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Controlador placeholder de requerimientos de personal. Sin lógica de
 * negocio: solo andamiaje de la Fase 1.
 *
 * RBAC: solo `admin_rrhh` y `lider_area` (los demás reciben 403).
 */
@Controller('requerimientos')
export class RequerimientosController {
  @Roles('admin_rrhh', 'lider_area')
  @Get('ping')
  ping() {
    return { modulo: 'requerimientos', status: 'placeholder' } as const;
  }
}
