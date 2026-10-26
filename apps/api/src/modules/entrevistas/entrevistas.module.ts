import { Module } from '@nestjs/common';

import { EntrevistasController } from './entrevistas.controller';
import { EntrevistasService } from './entrevistas.service';

/**
 * Módulo de las ENTREVISTAS de LARCO (Etapa 9, retroalimentación): agendar,
 * listar y editar entrevistas sobre una postulación, con el pool `pg` GLOBAL
 * (`DatabaseModule` es `@Global`, igual que en el embudo, así que no se
 * importa aquí). El placeholder de andamiaje de la Fase 1 se reemplazó por la
 * implementación real.
 */
@Module({
  controllers: [EntrevistasController],
  providers: [EntrevistasService],
  exports: [EntrevistasService],
})
export class EntrevistasModule {}
