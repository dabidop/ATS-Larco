import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Cuerpo de `POST /api/postulaciones/:id/descarte` (200 con la postulación
 * actualizada a `descartado`).
 *
 * El descarte es un ESTADO TERMINAL: la postulación sale del embudo desde
 * cualquier fase y ya no admite más cambios. El `motivo` es OBLIGATORIO (una
 * decisión de negocio que además garantiza la propia BD con el CHECK
 * `postulaciones_descarte_check` de la migración 007).
 *
 * Campos que el DTO NO acepta (400 con `forbidNonWhitelisted`): `fase` (el
 * cliente no elige adónde va al descartar: se queda donde está) y `estado`
 * (lo decide el servidor).
 *
 * NOTA: `@IsNotEmpty` solo descarta el string vacío, no los espacios en
 * blanco; el SERVICIO recorta el motivo y responde 400 con el mismo mensaje si
 * tras recortar queda vacío, de modo que un `'   '` jamás llega a BD (donde
 * el CHECK de la 007 sería la última red de seguridad).
 */
export class DescartarPostulacionDto {
  @IsString({ message: 'El motivo de descarte debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El motivo de descarte es obligatorio' })
  motivo!: string;
}
