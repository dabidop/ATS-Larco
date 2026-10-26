import { Module } from '@nestjs/common';

import { DepartamentosController } from './departamentos.controller';
import { DepartamentosService } from './departamentos.service';

/**
 * Módulo de los DEPARTAMENTOS de LARCO (Etapa 9, retroalimentación).
 *
 * Catálogo FIJO sembrado por la migración 009 (8 áreas con coordinador). El
 * módulo solo LEE el listado con estadísticas (`GET`) y ACTUALIZA el
 * coordinador (`PATCH`), con el pool `pg` GLOBAL (`DatabaseModule` es `@Global`,
 * igual que en el embudo, así que no se importa aquí).
 */
@Module({
  controllers: [DepartamentosController],
  providers: [DepartamentosService],
  exports: [DepartamentosService],
})
export class DepartamentosModule {}
