import { ETIQUETA_FASE, esAnteriorFase } from '../../lib/embudo';
import type { FasePostulacion } from '../../tipos';
import { CLASE_BOTON_PRINCIPAL, CLASE_BOTON_SECUNDARIO } from '../ui/estilos';

export function DialogoMovimiento({
  nombreCandidato,
  origen,
  destino,
  enviando,
  onConfirmar,
  onCancelar,
}: {
  nombreCandidato: string;
  origen: FasePostulacion;
  destino: FasePostulacion;
  enviando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const esDevolucion = esAnteriorFase(origen, destino);
  const accion = esDevolucion ? 'devolver' : 'avanzar';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmar-movimiento-titulo"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5">
        <h2 id="confirmar-movimiento-titulo" className="text-base font-semibold text-slate-100">
          Confirmar movimiento
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          ¿Confirmas {accion} a <strong>{nombreCandidato}</strong> de «{ETIQUETA_FASE[origen]}» a «
          {ETIQUETA_FASE[destino]}»?
        </p>
        <p className="mt-2 text-xs text-slate-400">
          {esDevolucion
            ? 'El candidato regresará a la etapa anterior para una nueva revisión.'
            : 'El candidato avanzará a la siguiente etapa del proceso.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={enviando}
            onClick={onConfirmar}
            className={CLASE_BOTON_PRINCIPAL}
          >
            {enviando ? 'Guardando…' : 'Confirmar'}
          </button>
          <button
            type="button"
            disabled={enviando}
            onClick={onCancelar}
            className={CLASE_BOTON_SECUNDARIO}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
