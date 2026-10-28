/**
 * Helpers de presentación: fechas, tamaños y conversiones de listas.
 * Todas las funciones son PURAS (sin DOM ni estado) para poder testearlas.
 */

/** Guion largo usado como «sin dato». */
export const SIN_DATO = '—';

/**
 * Formatea un ISO 8601 (o un `'YYYY-MM-DD'`, como `fechaRequerida`) como
 * `dd/mm/aaaa` usando las partes UTC, para que el resultado sea idéntico en
 * cualquier máquina (sin depender del huso del navegador).
 */
export function fechaCorta(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.length < 10) return SIN_DATO;
  const [anio, mes, dia] = iso.slice(0, 10).split('-');
  if (anio === undefined || mes === undefined || dia === undefined) return SIN_DATO;
  return `${dia}/${mes}/${anio}`;
}

/** Rellena con un `0` a la izquierda para que hora y día siempre sean 2 cifras. */
function dosDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/**
 * `dd/mm/aaaa HH:MM` en la HORA DEL SISTEMA (huso local de quien mira).
 *
 * El ISO que devuelve la API está en UTC (`timestamptz` de `pg`). La versión
 * anterior hacía `slice(11, 16)` sobre ese texto y pintaba la hora UTC
 * disfrazada de local —el bug de la bitácora—; ahora se construye con `Date`
 * y sus partes LOCALES (`getDate`, `getHours`…), así un registro hecho a las
 * 18:30 en Bogotá se ve a las 18:30 en cualquier máquina.
 *
 * `fechaCorta` NO cambia: sigue leyendo el texto de los `YYYY-MM-DD` de
 * negocio (`fechaRequerida`), fechas SIN hora que no deben correrse de día.
 */
export function fechaHora(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return SIN_DATO;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return SIN_DATO;
  return `${dosDigitos(fecha.getDate())}/${dosDigitos(fecha.getMonth() + 1)}/${fecha.getFullYear()} ${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`;
}

/** Tamaño legible de un fichero: KB o MB (base binaria, como ve el usuario). */
export function tamanoArchivo(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return SIN_DATO;
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

/** Formatea un salario/expectativa con separador de miles, sin decimales. */
export function dinero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return SIN_DATO;
  return valor.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Une una lista de textos para mostrarla en una tarjeta. */
export function listaATexto(items: readonly string[] | null | undefined): string {
  if (!items || items.length === 0) return SIN_DATO;
  return items.join(', ');
}

/**
 * Convierte un textarea separado por comas en el array que espera la API:
 * recorta espacios y descarta las entradas vacías (`"a, b ,"` → `['a','b']`).
 */
export function textoALista(texto: string): string[] {
  return texto
    .split(',')
    .map((entrada) => entrada.trim())
    .filter((entrada) => entrada.length > 0);
}

/** Muestra un valor del historial: `null`/`undefined` → guion, resto → texto. */
export function valorHistorial(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return SIN_DATO;
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  return JSON.stringify(valor);
}
