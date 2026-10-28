import { useDroppable } from '@dnd-kit/core';

import { ETIQUETA_FASE } from '../../lib/embudo';
import type { FasePostulacion, Postulacion } from '../../tipos';
import { EstadoVacio } from '../ui/feedback';
import { TarjetaPostulacion } from './TarjetaPostulacion';

/**
 * Columna del tablero Kanban (una por fase).
 *
 * Es un `useDroppable` con `id` = fase: al soltar aquí una tarjeta,
 * `DndContext.onDragEnd` ve `over.id === fase` y llama a `mover(id, fase)`.
 * El contador del cabecera muestra cuántas postulaciones hay en la fase.
 */
export function ColumnaEmbudo({
  fase,
  postulaciones,
  movible,
  cupoLleno,
  guardando,
  onMover,
  onDescartar,
  onHistorial,
}: {
  fase: FasePostulacion;
  postulaciones: Postulacion[];
  movible: boolean;
  /** `true` si las plazas ya están cubiertas (bloquea avanzar a Contratación). */
  cupoLleno: boolean;
  /** Ids con una mutación en vuelo (deshabilita sus acciones). */
  guardando: readonly string[];
  onMover: (id: string, destino: FasePostulacion) => void;
  onDescartar: (postulacion: Postulacion) => void;
  onHistorial: (postulacion: Postulacion) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: fase });

  return (
    <section
      aria-label={`Columna ${ETIQUETA_FASE[fase]}`}
      className={`flex min-w-0 w-full flex-col rounded-xl border p-3 transition ${
        isOver ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/40'
      }`}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">{ETIQUETA_FASE[fase]}</h2>
        <span
          aria-label={`${postulaciones.length} postulaciones`}
          className="inline-flex min-w-6 justify-center rounded-full bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-slate-300"
        >
          {postulaciones.length}
        </span>
      </header>

      <div ref={setNodeRef} className="flex flex-1 flex-col gap-2">
        {postulaciones.length === 0 ? (
          <EstadoVacio mensaje="Sin postulaciones" />
        ) : (
          postulaciones.map((postulacion) => (
            <TarjetaPostulacion
              key={postulacion.id}
              postulacion={postulacion}
              movible={movible}
              cupoLleno={cupoLleno}
              enGuardado={guardando.includes(postulacion.id)}
              onMover={(destino) => onMover(postulacion.id, destino)}
              onDescartar={() => onDescartar(postulacion)}
              onHistorial={() => onHistorial(postulacion)}
            />
          ))
        )}
      </div>
    </section>
  );
}
