import { CLASE_BOTON_SECUNDARIO } from './estilos';

/** Indicador de carga accesible (`role="status"`) para todas las vistas. */
export function Spinner({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-6 text-sm text-slate-300">
      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-400"
      />
      <span>{texto}</span>
    </div>
  );
}

/** Mensaje de error con acción de reintento opcional. */
export function MensajeError({
  mensaje,
  onReintentar,
  textoReintentar = 'Reintentar',
}: {
  mensaje: string;
  onReintentar?: () => void;
  textoReintentar?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-700/60 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
    >
      <p>{mensaje}</p>
      {onReintentar && (
        <button type="button" onClick={onReintentar} className={CLASE_BOTON_SECUNDARIO}>
          {textoReintentar}
        </button>
      )}
    </div>
  );
}

/** Confirmación visible de una operación que terminó bien. */
export function AvisoExito({ mensaje }: { mensaje: string }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-emerald-700/60 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200"
    >
      {mensaje}
    </p>
  );
}

/** Estado vacío de una lista («sin resultados»). */
export function EstadoVacio({ mensaje }: { mensaje: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-400">
      {mensaje}
    </div>
  );
}
