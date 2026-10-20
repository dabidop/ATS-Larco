/**
 * Cabecera `Content-Disposition` para descargar un CV con nombre original
 * (que puede llevar tildes, ñ o caracteres fuera de ASCII).
 *
 * Se emiten DOS declaraciones del nombre, como manda RFC 6266:
 *
 *  - `filename="..."` en ASCII como FALLA para clientes antiguos: los bytes
 *    no imprimibles o no ASCII se sustituyen por `_` (un nombre «mojibake» o
 *    una comilla partida rompería la cabecera en clientes viejos).
 *  - `filename*=UTF-8''...` percent-encoded en UTF-8: es el que usan los
 *    navegantes actuales y es el que conserva tildes y ñ EXACTOS.
 *
 * `encodeURIComponent` deja fuera de `!*'()~`, pero RFC 8187 solo admite como
 * `attr-char` las letras, dígitos y `!#$&+-.^_`|~`: por eso los cuatro
 * símbolos `*'()` se codifican además a mano.
 */

/** Percent-encoding extra exigido por RFC 8187 (`*'()` no son `attr-char`). */
function codificarExtValue(texto: string): string {
  return encodeURIComponent(texto).replace(
    /[*'()]/g,
    (car) => `%${car.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Construye `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<utf8>`.
 *
 * @param filename Nombre ORIGINAL del archivo (no se sanitiza para la base de
 *   datos: solo para la cabecera; el nombre en disco es el sha256).
 */
export function attachmentContentDisposition(filename: string): string {
  const ascii = filename
    // Todo lo que no sea ASCII imprimible (tildes, ñ, controles) → `_`.
    .replace(/[^ -~]/g, '_')
    // Comilla y barra invertida romperían la cadena entre comillas.
    .replace(/["\\]/g, '_');

  return `attachment; filename="${ascii}"; filename*=UTF-8''${codificarExtValue(filename)}`;
}
