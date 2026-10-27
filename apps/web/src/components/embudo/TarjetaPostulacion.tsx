import { useDraggable } from '@dnd-kit/core';

import { ETIQUETA_ESTADO_POSTULACION, ETIQUETA_FASE, esTerminal } from '../../lib/embudo';
import { FASES_POSTULACION, type Postulacion } from '../../tipos';

/**
 * Badge de color por estado de la postulación: `activa` neutro, `contratado`
 * verde y `descartado` gris/rojo.
 */
const CLASES_ESTADO: Readonly<Record<Postulacion['estado'], string>> = {
  activa: 'border-slate-500/40 bg-slate-500/15 text-slate-300',
  contratado: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  descartado: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
};

/** Estilo base de los botones diminutos de la tarjeta (▶ descartar historial). */
const CLASE_ACCION =
  'rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Tarjeta de una postulación en el tablero Kanban.
 *
 * DRAG: solo las postulaciones NO terminales son arrastrables (`useDraggable`
 * con `disabled` en terminales); el teclado también puede arrastrarla
 * (sensor por defecto de dnd-kit: Space para tomar, flechas para mover,
 * Space para soltar). Un `contratado` es terminal: queda visible pero NO
 * reasignable (retroalimentación Etapa 9, reglas 6 y 8).
 *
 * ACCIONES ALTERNATIVAS (accesibilidad y móvil): SOLO «▶ avanzar» apunta a la
 * fase SIGUIENTE (el embudo avanza; NO hay «◀» desde la Etapa 9), «Descartar»
 * y «Historial» — el DnD nunca es la única vía. Con el cupo completo, «▶» a
 * Contratación queda deshabilitado.
 */
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
  /** ¿Puede este rol/estado mover y descartar? (sin permiso → solo lectura). */
  movible: boolean;
  /** `true` si las plazas ya están cubiertas (bloquea avanzar a Contratación). */
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
  // El avance a `contratación` queda bloqueado si el cupo ya se cubrió.
  const avanceBloqueadoPorCupo =
    cupoLleno && posterior === 'contratacion' && postulacion.fase !== 'contratacion';

  const estilo = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <article
      ref={setNodeRef}
      style={estilo}
      className={`rounded-lg border bg-slate-900 p-3 text-sm shadow-sm ${
        isDragging ? 'border-emerald-500/70 opacity-70' : 'border-slate-800'
      }`}
    >
      {/* Zona de arrastre: nombre del candidato (con listeners del sensor). */}
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
