import { fechaHora, valorHistorial } from '../../lib/formato';
import { ETIQUETA_ACCION_HISTORIAL, ETIQUETA_CAMPO_HISTORIAL } from '../../lib/embudo';
import { useRecurso } from '../../lib/useRecurso';
import { solicitud } from '../../lib/api';
import type { EntradaHistorialPostulacion } from '../../tipos';
import { EstadoVacio, MensajeError, Spinner } from '../ui/feedback';

/**
 * Panel lateral con el historial de auditoría de una postulación
 * (`GET /api/postulaciones/:id/historial`, máx. 200 entradas, DESC).
 *
 * Cada entrada muestra la acción legible (Alta/Cambio/Borrado), la fecha, el
 * usuario (email si existe, si no el uuid) y los campos cambiados con el
 * formato «antes → después» (usando `valorHistorial` para pintar nulos y
 * valores no textuales).
 */
export function PanelHistorial({
  postulacionId,
  nombreCandidato,
  onCerrar,
}: {
  postulacionId: string;
  nombreCandidato: string;
  onCerrar: () => void;
}) {
  const recurso = useRecurso<EntradaHistorialPostulacion[]>(
    () => solicitud<EntradaHistorialPostulacion[]>(`/postulaciones/${postulacionId}/historial`),
    [postulacionId],
  );
  const entradas = recurso.datos;

  return (
    <aside
      aria-label={`Historial de ${nombreCandidato}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-2xl"
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Historial</p>
          <h2 className="text-sm font-semibold text-slate-100">{nombreCandidato}</h2>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
        >
          Cerrar
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {recurso.fase === 'cargando' && <Spinner texto="Cargando historial…" />}
        {recurso.fase === 'error' && (
          <MensajeError
            mensaje={recurso.error ?? 'No se pudo cargar el historial'}
            onReintentar={recurso.recargar}
          />
        )}
        {recurso.fase === 'listo' && entradas !== null && entradas.length === 0 && (
          <EstadoVacio mensaje="Sin cambios registrados para esta postulación." />
        )}

        {entradas !== null && entradas.length > 0 && (
          <ol className="space-y-3">
            {entradas.map((entrada) => (
              <li
                key={entrada.id}
                className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-emerald-300">
                    {ETIQUETA_ACCION_HISTORIAL[entrada.accion] ?? entrada.accion}
                  </span>
                  <time className="text-xs text-slate-500">{fechaHora(entrada.fecha)}</time>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {entrada.usuarioEmail ?? entrada.usuario ?? '—'}
                </p>
                <ul className="mt-2 space-y-1">
                  {entrada.campos.map((cambio, indice) => (
                    <li
                      key={`${entrada.id}-${cambio.campo}-${indice}`}
                      className="text-xs text-slate-300"
                    >
                      <span className="text-slate-500">
                        {ETIQUETA_CAMPO_HISTORIAL[cambio.campo] ?? cambio.campo}:{' '}
                      </span>
                      {valorHistorial(cambio.antes)} → {valorHistorial(cambio.despues)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
