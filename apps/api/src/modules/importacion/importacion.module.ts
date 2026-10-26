import { Module } from '@nestjs/common';

import { UploadsModule } from '../uploads/uploads.module';
import { ImportacionController } from './importacion.controller';
import { ImportacionService } from './importacion.service';

/**
 * Módulo de la IMPORTACIÓN MASIVA de HVs de LARCO (Etapa 9, retroalimentación).
 *
 * Depende de `UploadsModule` (que EXPORTA `ArchivosCvService`) para adjuntar
 * cada PDF como CV del candidato creado; la dependencia es EN UN SOLO SENTIDO
 * (importacion → uploads), igual que `CandidatosModule`, así que no hay ciclo
 * de módulos. El placeholder de andamiaje de la Fase 1 se reemplazó por la
 * implementación real.
 */
@Module({
  imports: [UploadsModule],
  controllers: [ImportacionController],
  providers: [ImportacionService],
  exports: [ImportacionService],
})
export class ImportacionModule {}
