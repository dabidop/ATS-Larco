import { useCallback, useEffect, useRef, useState } from 'react';

import { mensajeDeError } from './api';

/**
 * Ciclo de vida de una carga de datos con estados `cargando` / `listo` /
 * `error` y botón de reintento — usado por TODAS las vistas que leen de la
 * API (listas, detalle, archivos, historial).
 *
 * `cargar` se guarda en un ref para poder invocarla desde el reintento sin
 * meterla en las dependencias del efecto (si no, cambiaría en cada render y
 * provocaría un bucle de peticiones).
 */

export type FaseCarga = 'cargando' | 'listo' | 'error';

export interface Recurso<T> {
  fase: FaseCarga;
  /** Último dato correcto, o `null` mientras no haya cargado nada. */
  datos: T | null;
  /** Mensaje en español del último fallo. */
  error: string | null;
  /** Fuerza una nueva carga (botón «Reintentar»). */
  recargar: () => void;
}

export function useRecurso<T>(
  cargar: () => Promise<T>,
  dependencias: readonly unknown[],
): Recurso<T> {
  const [fase, setFase] = useState<FaseCarga>('cargando');
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  // Última versión de `cargar`, siempre fresca sin disparar el efecto.
  const cargaActual = useRef(cargar);
  cargaActual.current = cargar;

  useEffect(() => {
    let vivo = true;
    setFase('cargando');
    setError(null);
    void (async () => {
      try {
        const resultado = await cargaActual.current();
        if (!vivo) return;
        setDatos(resultado);
        setFase('listo');
      } catch (capturado) {
        if (!vivo) return;
        setError(mensajeDeError(capturado, 'No se pudo cargar la información'));
        setFase('error');
      }
    })();
    return () => {
      vivo = false;
    };
    // El llamante declara las dependencias reales en `dependencias`; el
    // spread es intencional y la regla no puede verificarlo estáticamente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencias, intento]);

  const recargar = useCallback(() => setIntento((anterior) => anterior + 1), []);

  return { fase, datos, error, recargar };
}
