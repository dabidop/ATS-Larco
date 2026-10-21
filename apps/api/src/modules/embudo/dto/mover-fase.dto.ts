import { IsEnum } from 'class-validator';

import { FASES, type Fase } from '../postulaciones-fases';

/**
 * Cuerpo de `PATCH /api/postulaciones/:id/fase` (200 con la postulación
 * actualizada).
 *
 * El cliente solo dice A QUÉ fase quiere moverla; la validación de que el
 * movimiento es legal (adyacencia, estado terminal) y el estado RESULTANTE
 * (`contratacion` ⇒ `contratado`) los decide el SERVIDOR —
 * `PostulacionesService.cambiarFase`—. Las 5 fases admitidas son las del ENUM
 * `fase_postulacion`; el orden vive en `postulaciones-fases.ts`.
 *
 * Campos que el DTO NO acepta (por tanto, 400 con `forbidNonWhitelisted`):
 * `estado`, `motivo` y `motivoDescarte`. El cliente no escribe el desenlace ni
 * comenta el movimiento desde aquí: el motivo SOLO existe en el descarte,
 * con su propio endpoint `POST /:id/descarte`, único lugar donde se persiste
 * (la migración 007 reserva `motivo_descarte` en exclusiva al estado
 * `descartado`). Si el negocio necesita comentar MOVIMIENTOS de fase, habrá
 * que añadir una columna propia en una migración nueva.
 */
export class MoverFaseDto {
  @IsEnum(FASES, { message: `fase debe ser una de: ${FASES.join(', ')}` })
  fase!: Fase;
}
