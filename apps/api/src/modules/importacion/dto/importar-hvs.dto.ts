import { IsUUID } from 'class-validator';

/**
 * Cuerpo de `POST /api/importacion/hvs` (Etapa 9): los archivos van en el
 * multipart (`archivos`, ≤ 50 PDFs de ≤ 5 MB) y ESTE campo texto indica el
 * DESTINO del lote (área LARCO a la que quedan etiquetados los candidatos
 * importados). Sin él la importación no sabe dónde clasificar los HVs.
 */
export class ImportarHvsDto {
  /** Área LARCO de destino (404 si no existe; se comprueba ANTES del lote). */
  @IsUUID('4', { message: 'departamentoId debe ser un UUID válido' })
  departamentoId!: string;
}
