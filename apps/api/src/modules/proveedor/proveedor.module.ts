import { Module } from '@nestjs/common';

import { ProveedorController } from './proveedor.controller';

/** Módulo del portal/panel del proveedor externo (andamiaje de la Fase 1). */
@Module({
  controllers: [ProveedorController],
})
export class ProveedorModule {}
