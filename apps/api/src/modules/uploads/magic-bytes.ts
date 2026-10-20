/**
 * Detección de tipo de archivo por MAGIC BYTES (Fase 4, parte 2).
 *
 * FUNCIÓN PURA: solo mira los bytes del buffer. NO usa la extensión del
 * nombre, NI el `Content-Type` que declare el cliente en el multipart —ambos
 * los controla quien sube el archivo y por tanto SON INFORMACIÓN NO FIABLE—.
 * El resultado es además lo que se persiste en `archivos_cv.mime_type`: la BD
 * guarda siempre un MIME derivado por el servidor.
 *
 * Firmas exactas que se comprueban (todas desde el byte 0):
 *
 * | Tipo | Firma hexadecimal            | Literal            |
 * |------|------------------------------|--------------------|
 * | PDF  | `25 50 44 46 2D`             | `%PDF-`            |
 * | DOC  | `D0 CF 11 E0 A1 B1 1A E1`    | contenedor OLE2    |
 * | RTF  | `7B 5C 72 74 66`             | `{\rtf`            |
 * | DOCX | `50 4B 03 04` (ZIP) + más    | ver abajo          |
 * | Otro | —                            | `null` → HTTP 400  |
 *
 * COBERTURA Y LÍMITES DE DOCX (decisión documentada con honestidad):
 *
 * Un `.docx` es un paquete OPC comprimido, así que empieza igual que
 * CUALQUIER `.zip` (`PK\x03\x04`): con esa firma solo ya pasarían ficheros ZIP
 * ajenos a Word. Por eso, además de `PK\x03\x03`, se exige que el buffer
 * contenga DOS literales ASCII que solo caben en un paquete Word real:
 *
 *  - `[Content_Types].xml` → obligatorio en todo paquete OPC (ECMA-376).
 *  - `word/` → la carpeta de partes de un documento Word (`word/document.xml`).
 *
 * En ZIP los nombres de entrada se guardan SIEMPRE en claro (la compresión
 * solo afecta al contenido), así que ambos literales son legibles en el buffer
 * completo, que sí está entero en memoria (el límite de 5 MB lo garantiza).
 *
 * Lo que esto CUBRE: PDF, DOC (OLE2), RTF y DOCX reales (Word, LibreOffice,
 * Google Docs) → aceptados; `.txt`, `.png`, `.xlsx`, `.pptx` y un `.zip`
 * genérico sin esas entradas → rechazados con `null` (400).
 *
 * Lo que NO cubre (conocido y asumido en Fase 4):
 *  - Un ZIP que contenga a su vez una carpeta `word/` extraída con su
 *    `[Content_Types].xml` pasaría como DOCX (falso positivo residual: el
 *    contenido sigue siendo Word). Si alguna vez importa, se refina abriendo el
 *    ZIP con una librería real y exigiendo `word/document.xml`.
 *  - Un DOCX protegido con contraseña sale cifrado y NO lleva `word/` en claro
 *    → se rechaza con 400 (no sabríamos leerlo igualmente).
 *  - Un `.doc` genuino es OLE2, familia que también usan `.xls`/`.ppt`
 *    antiguos: se aceptan como DOC. Distinguirlos exigiría parsear el
 *    stream `\x01Ole10Native`/`Workbook` del contenedor.
 */

/** Tipos de archivo que la API acepta como CV. */
export type TipoArchivoCv = 'pdf' | 'doc' | 'docx' | 'rtf';

/**
 * MIME canónico de cada tipo. Es lo que se guarda en `archivos_cv.mime_type`
 * y lo que se devuelve en `Content-Type` al descargar: SIEMPRE derivado aquí,
 * nunca el `mimetype` que declara el cliente.
 */
export const MIME_POR_TIPO: Readonly<Record<TipoArchivoCv, string>> = Object.freeze({
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
});

/** `%PDF-` */
const FIRMA_PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
/** OLE2 / Compound File Binary: contenedor del Office 97-2003 (`.doc`). */
const FIRMA_OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** `{\rtf` */
const FIRMA_RTF = Buffer.from([0x7b, 0x5c, 0x72, 0x74, 0x66]);
/** `PK\x03\x04` — cabecera local de una entrada ZIP (docx es un ZIP). */
const FIRMA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Literales ASCII obligatorios de un paquete OPC de Word (ver cabecera). */
const LITERAL_CONTENT_TYPES = Buffer.from('[Content_Types].xml', 'latin1');
const LITERAL_CARPETA_WORD = Buffer.from('word/', 'latin1');

/** ¿El buffer empieza EXACTAMENTE por la firma dada? */
function empiezaCon(buffer: Buffer, firma: Buffer): boolean {
  return buffer.subarray(0, firma.length).equals(firma);
}

/** ¿Es un ZIP que además parece un paquete Word (ver límites en la cabecera)? */
function esPaqueteWord(buffer: Buffer): boolean {
  return buffer.includes(LITERAL_CONTENT_TYPES) && buffer.includes(LITERAL_CARPETA_WORD);
}

/**
 * Detecta el tipo de archivo a partir de sus magic bytes.
 *
 * @param buffer Contenido COMPLETO del archivo (en memoria: ≤ 5 MB).
 * @returns `'pdf' | 'doc' | 'docx' | 'rtf'` o `null` si la firma no corresponde
 *   a ninguno de los tipos permitidos (la capa de servicio responde 400).
 */
export function detectarTipo(buffer: Buffer): TipoArchivoCv | null {
  if (empiezaCon(buffer, FIRMA_PDF)) {
    return 'pdf';
  }
  if (empiezaCon(buffer, FIRMA_OLE2)) {
    return 'doc';
  }
  if (empiezaCon(buffer, FIRMA_RTF)) {
    return 'rtf';
  }
  if (empiezaCon(buffer, FIRMA_ZIP) && esPaqueteWord(buffer)) {
    return 'docx';
  }
  return null;
}
