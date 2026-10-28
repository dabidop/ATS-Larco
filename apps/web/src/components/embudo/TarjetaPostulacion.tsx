import { useDraggable } from '@dnd-kit/core';

import { ETIQUETA_ESTADO_POSTULACION, ETIQUETA_FASE, esTerminal } from '../../lib/embudo';
import { FASES_POSTULACION, type Postulacion } from '../../tipos';

const CLASES_ESTADO: Readonly<Record<Postulacion['estado'], string>> = {
  activa: 'border-slate-500/40 bg-slate-500/15 text-slate-300',
  contratado: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  descartado: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
};

const CLASE_ACCION =
  'rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40';

/** Tarjeta de una postulación en el tablero Kanban. */
export function TarjetaPostulacion({
  postulacion,
  movible,
  cupoLleno,
  enGuardado,
  onMover,
  onDescartar,
  onHistorial,
}: {
  postulacion: Postulacion;
  movible: boolean;
  cupoLleno: boolean;
  enGuardado: boolean;
  onMover: (destino: Postulacion['fase']) => void;
  onDescartar: () => void;
  onHistorial: () => void;
}) {
  const terminal = esTerminal(postulacion.estado);
  const arrastrable = movible && !terminal;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: postulacion.id,
    disabled: !arrastrable,
  });

  const indice = FASES_POSTULACION.indexOf(postulacion.fase);
  const posterior =
    indice >= 0 && indice < FASES_POSTULACION.length - 1
      ? FASES_POSTULACION[indice + 1]
      : undefined;
  const avanceBloqueadoPorCupo =
    cupoLleno && posterior === 'contratacion' && postulacion.fase !== 'contratacion';

  const estilo = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const fondoPorFase: Record<Postulacion['fase'], string> = {
    preseleccion: 'bg-rose-950/70',
    antecedentes: 'bg-orange-950/70',
    entrevistas: 'bg-amber-950/70',
    proveedor_externo: 'bg-sky-950/70',
    contratacion: 'bg-emerald-950/70',
  };

  return (
    <article
      ref={setNodeRef}
      style={estilo}
      className={`rounded-lg border p-3 text-sm shadow-sm ${fondoPorFase[postulacion.fase]} ${isDragging ? 'border-emerald-500/70 opacity-70' : 'border-slate-800'
        }`}
    >
      <div {...listeners} {...attributes} className={arrastrable ? 'cursor-grab' : undefined}>
        <p className="font-medium text-slate-100">
          {postulacion.candidato.nombres} {postulacion.candidato.apellidos}
        </p>
        <p className="mt-1 text-xs text-slate-500">{ETIQUETA_FASE[postulacion.fase]}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${CLASES_ESTADO[postulacion.estado]}`}
        >
          {ETIQUETA_ESTADO_POSTULACION[postulacion.estado]}
        </span>
      </div>

      {postulacion.estado === 'descartado' && postulacion.motivoDescarte !== null && (
        <p className="mt-2 truncate text-xs text-rose-300/90" title={postulacion.motivoDescarte}>
          Motivo: {postulacion.motivoDescarte}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {movible && !terminal && posterior !== undefined && (
          <button
            type="button"
            title={
              avanceBloqueadoPorCupo
                ? 'Plazas cubiertas: no se puede avanzar a Contratación'
                : `Mover a ${ETIQUETA_FASE[posterior]}`
            }
            aria-label={`Mover a ${ETIQUETA_FASE[posterior]}`}
            disabled={enGuardado || avanceBloqueadoPorCupo}
            onClick={() => onMover(posterior)}
            className={CLASE_ACCION}
          >
            ▶
          </button>
        )}
        {movible && !terminal && (
          <button
            type="button"
            disabled={enGuardado}
            onClick={onDescartar}
            className={`${CLASE_ACCION} border-rose-800/60 text-rose-300 hover:bg-rose-950/60`}
          >
            Descartar
          </button>
        )}
        <button type="button" onClick={onHistorial} className={CLASE_ACCION}>
          Historial
        </button>
      </div>
    </article>
  );
}
