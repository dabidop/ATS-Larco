import { useId, useState } from 'react';

import { CLASE_BOTON_PELIGRO, CLASE_BOTON_SECUNDARIO, CLASE_CAMPO } from '../ui/estilos';
/** Mínimo de caracteres (tras recortar) que exige el formulario de descarte. */
export const LONGITUD_MINIMA_MOTIVO = 5;

/** Mensaje de validación del motivo (el servidor también responde 400). */
export const MENSAJE_MOTIVO_CORTO = `El motivo debe tener al menos ${LONGITUD_MINIMA_MOTIVO} caracteres`;

/**
 * Diálogo (modal) de descarte de una postulación.
 *
 * El motivo es OBLIGATORIO: el botón «Aceptar» sigue deshabilitado mientras
 * el texto recortado no llegue a `LONGITUD_MINIMA_MOTIVO` (el servidor responde
 * 400 si el motivo llega vacío, y la validación local evita ese viaje).
 */
export function DialogoDescarte({
  nombreCandidato,
  enviando,
  error,
  onConfirmar,
  onCancelar,
}: {
  nombreCandidato: string;
  enviando: boolean;
  /** Error del último intento (p. ej. 409 «Estado terminal…»). */
  error: string | null;
  onConfirmar: (motivo: string) => void;
  onCancelar: () => void;
}) {
  const idMotivo = useId();
  const [motivo, setMotivo] = useState('');
  const valido = motivo.trim().length >= LONGITUD_MINIMA_MOTIVO;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${idMotivo}-titulo`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5">
        <h2 id={`${idMotivo}-titulo`} className="text-base font-semibold text-slate-100">
          Descartar postulación
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {nombreCandidato} saldrá del embudo con estado «Descartado». Esta acción es definitiva.
        </p>

        <label
          htmlFor={idMotivo}
          className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-400"
        >
          Motivo del descarte (obligatorio, mínimo {LONGITUD_MINIMA_MOTIVO} caracteres)
        </label>
        <textarea
          id={idMotivo}
          rows={3}
          className={`mt-1 ${CLASE_CAMPO}`}
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value)}
          placeholder="Ej.: no aprueba la entrevista técnica"
        />

        {error !== null && (
          <p role="alert" className="mt-2 text-xs text-rose-400">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!valido || enviando}
            onClick={() => onConfirmar(motivo.trim())}
            className={CLASE_BOTON_PELIGRO}
          >
            {enviando ? 'Descartando…' : 'Aceptar'}
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
