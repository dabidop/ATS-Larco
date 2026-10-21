/**
 * Reglas de subida de CVs replicando los límites del servidor.
 *
 * El backend (`apps/api/src/modules/uploads`) valida con MAGIC BYTES
 * (`magic-bytes.ts`) y Multer limita a 5 MB (`LIMITE_TAMANO_CV` del
 * `CandidatosController`); los tipos aceptados son PDF, DOC, DOCX y RTF.
 *
 * En el cliente validamos ANTES de subir (extensión + tamaño) para no gastar
 * un upload en algo que el servidor rechazará. No es seguridad: el servidor
 * vuelve a validar por magic bytes, que es la única comprobación fiable (la
 * extensión y el MIME los controla quien sube el fichero).
 */

/** Límite de Multer en el servidor: 5 MB en bytes. */
export const LIMITE_ARCHIVO_CV = 5 * 1024 * 1024;

/** Extensiones admitidas (en minúsculas). */
export const EXTENSIONES_CV = ['pdf', 'doc', 'docx', 'rtf'] as const;

/**
 * Valida un fichero candidato a CV.
 *
 * @returns Mensaje de error en español, o `null` si el fichero es válido.
 */
export function validarArchivoCv(archivo: Pick<File, 'name' | 'size'>): string | null {
  const extension = archivo.name.split('.').pop()?.toLowerCase() ?? '';
  if (!(EXTENSIONES_CV as readonly string[]).includes(extension)) {
    const recibido = extension.length > 0 ? `.${extension}` : '(sin extensión)';
    return `Formato no admitido: solo se aceptan PDF, DOC, DOCX o RTF (recibido ${recibido})`;
  }
  if (archivo.size > LIMITE_ARCHIVO_CV) {
    const megas = (archivo.size / (1024 * 1024)).toFixed(1);
    return `El archivo supera el límite de 5 MB (recibido ${megas} MB)`;
  }
  return null;
}
