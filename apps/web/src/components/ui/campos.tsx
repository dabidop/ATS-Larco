import { useId } from 'react';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { CLASE_CAMPO, CLASE_CAMPO_CON_ERROR, CLASE_ETIQUETA } from './estilos';

/**
 * Campo de texto con etiqueta, error accesible y controlado desde el
 * formulario (el valor llega como string y se emite tal cual).
 */
interface PropiedadesCampoTexto extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value'
> {
  etiqueta: string;
  valor: string;
  onCambio: (valor: string) => void;
  error?: string;
}

export function CampoTexto({
  etiqueta,
  valor,
  onCambio,
  error,
  id,
  ...resto
}: PropiedadesCampoTexto) {
  const idGenerado = useId();
  const idCampo = id ?? idGenerado;
  return (
    <div>
      <label htmlFor={idCampo} className={CLASE_ETIQUETA}>
        {etiqueta}
      </label>
      <input
        id={idCampo}
        value={valor}
        onChange={(evento) => onCambio(evento.target.value)}
        aria-invalid={error === undefined ? undefined : 'true'}
        aria-describedby={error === undefined ? undefined : `${idCampo}-error`}
        className={error === undefined ? CLASE_CAMPO : CLASE_CAMPO_CON_ERROR}
        {...resto}
      />
      {error && (
        <p id={`${idCampo}-error`} className="mt-1 text-xs text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** Variante de área de texto (conocimientos, justificación, notas…). */
interface PropiedadesCampoArea extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange' | 'value'
> {
  etiqueta: string;
  valor: string;
  onCambio: (valor: string) => void;
  error?: string;
}

export function CampoArea({
  etiqueta,
  valor,
  onCambio,
  error,
  id,
  ...resto
}: PropiedadesCampoArea) {
  const idGenerado = useId();
  const idCampo = id ?? idGenerado;
  return (
    <div>
      <label htmlFor={idCampo} className={CLASE_ETIQUETA}>
        {etiqueta}
      </label>
      <textarea
        id={idCampo}
        value={valor}
        onChange={(evento) => onCambio(evento.target.value)}
        aria-invalid={error === undefined ? undefined : 'true'}
        aria-describedby={error === undefined ? undefined : `${idCampo}-error`}
        className={error === undefined ? CLASE_CAMPO : CLASE_CAMPO_CON_ERROR}
        {...resto}
      />
      {error && (
        <p id={`${idCampo}-error`} className="mt-1 text-xs text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
