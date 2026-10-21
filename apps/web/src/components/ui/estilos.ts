/**
 * Estilos compartidos (Tailwind v4 puro: clases utilitarias, sin librerías de
 * componentes). Centralizados para que botones, campos y tarjetas se vean
 * idénticos en todas las páginas.
 */

export const CLASE_BOTON_PRINCIPAL =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50';

export const CLASE_BOTON_SECUNDARIO =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50';

export const CLASE_BOTON_PELIGRO =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50';

export const CLASE_CAMPO =
  'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none';

export const CLASE_CAMPO_CON_ERROR =
  'w-full rounded-lg border border-rose-500/70 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-400 focus:outline-none';

export const CLASE_TARJETA = 'rounded-xl border border-slate-800 bg-slate-900 p-5';

export const CLASE_ETIQUETA = 'text-xs font-semibold uppercase tracking-wide text-slate-400';
