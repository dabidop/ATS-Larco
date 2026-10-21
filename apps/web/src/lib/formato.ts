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

/** `dd/mm/aaaa HH:MM` (UTC) para el historial y los timestamps. */
export function fechaHora(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.length < 16) return SIN_DATO;
  const hora = iso.slice(11, 16);
  return `${fechaCorta(iso)} ${hora}`;
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
