import { Controller, Get } from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Controlador placeholder de importación de datos. Sin lógica de negocio:
 * solo andamiaje de la Fase 1.
 *
 * RBAC: `admin_rrhh`, `analista_seleccion` y `superusuario` (hereda TODO el
 * poder de `admin_rrhh`, Etapa 8B); los demás reciben 403.
 */
@Controller('importacion')
export class ImportacionController {
  @Roles('admin_rrhh', 'superusuario', 'analista_seleccion')
  @Get('ping')
  ping() {
    return { modulo: 'importacion', status: 'placeholder' } as const;
  }
}
