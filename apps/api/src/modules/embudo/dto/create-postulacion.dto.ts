import { IsUUID } from 'class-validator';

/**
 * Cuerpo de `POST /api/postulaciones` (201).
 *
 * El cliente solo dice QUIÉN postula y PARA QUÉ requerimiento: la fase
 * (`preseleccion`) y el estado (`activa`) los decide el SERVIDOR, nunca el
 * cliente. Lo que NO aparece aquí —a propósito—:
 *  - `fase`, `estado`, `motivoDescarte`: los escribe el embudo (máquina de
 *    fases + descartes), no el cliente.
 *  - `createdBy`: lo toma el controlador del JWT (`request.user.sub`).
 * El ValidationPipe global (`whitelist` + `forbidNonWhitelisted`) responde 400
 * si el cliente envía alguno de esos campos.
 */
export class CreatePostulacionDto {
  @IsUUID(undefined, { message: 'candidatoId debe ser un UUID válido' })
  candidatoId!: string;

  @IsUUID(undefined, { message: 'requerimientoId debe ser un UUID válido' })
  requerimientoId!: string;
}
