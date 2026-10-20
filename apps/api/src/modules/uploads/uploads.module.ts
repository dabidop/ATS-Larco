import { Module } from '@nestjs/common';

import { AlmacenamientoService } from './almacenamiento.service';
import { ArchivosCvService } from './archivos-cv.service';
import { UploadsController } from './uploads.controller';

/**
 * Módulo de carga de archivos — CVs de los candidatos (Fase 4, parte 2).
 *
 * Contiene DOS providers con responsabilidades separadas:
 *
 *  - `AlmacenamientoService`: disco puro por CONTENIDO (`<UPLOAD_DIR>/<sha256>`,
 *    dedup, anti path-traversal, retención). No conoce HTTP ni SQL.
 *  - `ArchivosCvService`: casos de uso de la tabla `archivos_cv` (subir,
 *    listar, descargar) = magic bytes + almacén + pool `pg`.
 *
 * Ambos se EXPORTAN porque `CandidatosModule` importa ESTE módulo para servir
 * los endpoints `POST/GET /api/candidatos/:id/archivos...` desde su controlador
 * (la subida vive en la ruta del candidato, no en `/api/uploads`).
 *
 * La dependencia es EN UN SOLO SENTIDO (candidatos → uploads) a propósito:
 * aquí se usa el pool `pg` GLOBAL (`DatabaseService`), no el `DataSource` de
 * TypeORM de candidatos, así que no hay ciclo de módulos y este módulo tampoco
 * necesita DataSource propio. El ping placeholder `GET /api/uploads/ping`
 * (Fase 1) sigue igual.
 */
@Module({
  controllers: [UploadsController],
  providers: [AlmacenamientoService, ArchivosCvService],
  exports: [AlmacenamientoService, ArchivosCvService],
})
export class UploadsModule {}
