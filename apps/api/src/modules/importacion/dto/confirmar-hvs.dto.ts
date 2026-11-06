import { IsJSON, IsUUID } from 'class-validator';

/** Revisión editable enviada por la UI, asociada al índice del multipart. */
export interface RevisionImportacionDto {
  indice: number;
  nombres: string;
  apellidos: string;
  email?: string | null;
  telefono?: string | null;
  ciudad?: string | null;
  habilidades?: string[];
}

export class ConfirmarHvsDto {
  @IsUUID('4', { message: 'departamentoId debe ser un UUID válido' })
  departamentoId!: string;

  /** JSON para conservar el orden y permitir editar cada sugerencia. */
  @IsJSON({ message: 'revisiones debe ser un JSON válido' })
  revisiones!: string;
}
