import { IsEnum, IsOptional, IsString } from 'class-validator';

import { EstadoRequerimiento, ResultadoCierre } from '../requerimiento.entity';

/**
 * Cuerpo de `POST /api/requerimientos/:id/transiciones`.
 *
 * `destino` admite SOLO los 4 estados distintos de `pendiente`: `pendiente`
 * es el estado de partida (nunca es destino) y las reglas de qué combinaciones
 * existen entre estados viven en la máquina de estados
 * (`requerimientos-flujo.ts`), no en la validación de forma.
 *
 * Campos que el DTO NO acepta (por tanto, 400 con `forbidNonWhitelisted`):
 * `estado` (el cliente NO escribe el estado directamente: lo decide la
 * transición) y `createdBy` (inmutable, viene del JWT).
 */
export const DESTINOS_TRANSICION = [
  EstadoRequerimiento.Aprobado,
  EstadoRequerimiento.Rechazado,
  EstadoRequerimiento.EnProceso,
  EstadoRequerimiento.Cerrado,
] as const;

/** Uno de los 4 estados alcanzables por una transición. */
export type DestinoTransicion = (typeof DESTINOS_TRANSICION)[number];

export class TransicionarRequerimientoDto {
  @IsEnum(DESTINOS_TRANSICION, {
    message: `destino debe ser uno de: ${DESTINOS_TRANSICION.join(', ')}`,
  })
  destino!: DestinoTransicion;

  /**
   * Obligatorio SOLO cuando `destino = 'rechazado'` (lo exige el servicio con
   * un 400 claro y, en última instancia, el CHECK `requerimientos_rechazo_check`
   * de la BD). Para el resto de destinos se ignora si viene.
   *
   * Etapa 9: `destino = 'cerrado'` TAMBIÉN lo exige («cerrar» ahora responde
   * POR QUÉ se cierra; CHECK `requerimientos_cierre_check`).
   */
  @IsOptional()
  @IsString({ message: 'motivo debe ser una cadena de texto' })
  motivo?: string;

  /**
   * Obligatorio SOLO cuando `destino = 'cerrado'` (Etapa 9): ¿se cerró con
   * ALGUIEN CONTRATADO (`contratacion`) o se vació la plaza
   * (`cierre_vacante`)? El servicio responde 400 si falta.
   */
  @IsOptional()
  @IsEnum(ResultadoCierre, {
    message: `resultado debe ser uno de: ${Object.values(ResultadoCierre).join(', ')}`,
  })
  resultado?: ResultadoCierre;
}
