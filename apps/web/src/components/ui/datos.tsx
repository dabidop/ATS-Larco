import { useState } from 'react';
import type { ReactNode } from 'react';

import { ETIQUETA_ESTADO } from '../../lib/flujo';
import type { EstadoRequerimiento, UrgenciaRequerimiento } from '../../tipos';
import { CLASE_BOTON_SECUNDARIO, CLASE_ETIQUETA, CLASE_TARJETA } from './estilos';

/** Badge de color por estado del requerimiento. */
const CLASES_ESTADO: Readonly<Record<EstadoRequerimiento, string>> = {
  pendiente: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  aprobado: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  en_proceso: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
  cerrado: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  rechazado: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  exitoso: 'border-emerald-400/60 bg-emerald-400/15 text-emerald-200',
};

export function BadgeEstado({ estado }: { estado: EstadoRequerimiento }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CLASES_ESTADO[estado]}`}
    >
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

const ETIQUETA_URGENCIA: Readonly<Record<UrgenciaRequerimiento, string>> = {
  normal: 'Normal',
  alta: 'Alta',
  critica: 'Crítica',
};

const CLASES_URGENCIA: Readonly<Record<UrgenciaRequerimiento, string>> = {
  normal: 'border-slate-600 bg-slate-700/40 text-slate-300',
  alta: 'border-amber-500/50 bg-amber-500/15 text-amber-300',
  critica: 'border-rose-500/50 bg-rose-500/15 text-rose-300',
};

/** Badge visual de la prioridad/urgencia de una vacante. */
export function BadgeUrgencia({ urgencia }: { urgencia: UrgenciaRequerimiento }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CLASES_URGENCIA[urgencia]}`}
    >
      {ETIQUETA_URGENCIA[urgencia]}
    </span>
  );
}

/** Tarjeta de sección con título (las 5 secciones del formulario). */
export function Tarjeta({
  titulo,
  children,
  extra,
  colapsable = false,
}: {
  titulo: string;
  children: ReactNode;
  extra?: ReactNode;
  colapsable?: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  return (
    <section className={CLASE_TARJETA}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {colapsable ? (
          <button
            type="button"
            className="flex items-center gap-2 text-left text-sm font-semibold text-slate-200 hover:text-white"
            aria-expanded={abierta}
            onClick={() => setAbierta((actual) => !actual)}
          >
            <span aria-hidden="true" className="text-slate-400">
              {abierta ? '▾' : '▸'}
            </span>
            <span>{titulo}</span>
          </button>
        ) : (
          <h2 className="text-sm font-semibold text-slate-200">{titulo}</h2>
        )}
        {extra}
      </div>
      {(!colapsable || abierta) && children}
    </section>
  );
}

/** Par etiqueta/valor para las `<dl>` de los detalles. */
export function FilaDato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className={CLASE_ETIQUETA}>{etiqueta}</dt>
      <dd className="mt-1 text-sm break-words text-slate-100">{valor}</dd>
    </div>
  );
}

/**
 * Paginación «anterior/siguiente» con el total de registros y de páginas
 * (`{items,total,page,limit}` de la API).
 */
export function Paginacion({
  pagina,
  total,
  limit,
  onCambio,
}: {
  pagina: number;
  total: number;
  limit: number;
  onCambio: (pagina: number) => void;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-400">
        Página {pagina} de {totalPaginas} · {total} {total === 1 ? 'registro' : 'registros'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onCambio(pagina - 1)}
          disabled={pagina <= 1}
          className={CLASE_BOTON_SECUNDARIO}
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => onCambio(pagina + 1)}
          disabled={pagina >= totalPaginas}
          className={CLASE_BOTON_SECUNDARIO}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
