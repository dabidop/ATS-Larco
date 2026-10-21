import { useState } from 'react';
import type { FormEvent } from 'react';

import { solicitud } from '../../lib/api';
import { EstadoVacio, MensajeError, Spinner } from '../ui/feedback';
import { CLASE_BOTON_PRINCIPAL, CLASE_BOTON_SECUNDARIO, CLASE_CAMPO } from '../ui/estilos';
import type { Candidato, Pagina } from '../../tipos';

/** Tamaño de página de la búsqueda (el tablero solo necesita elegir UNO). */
const LIMITE_BUSQUEDA = 10;

/**
 * Formulario de ALTA de una postulación en el tablero: busca candidatos por
 * nombre (`GET /api/candidatos?q=`) y permite elegir uno de los resultados
 * para registrarlo (`POST /api/postulaciones` vía `onAgregar`).
 *
 * Si el candidato YA postula al requerimiento, el servidor responde 409 con
 * un mensaje claro que se pinta aquí (no se duplica la comprobación en
 * cliente: la API es la verdad).
 */
export function FormularioAgregarPostulacion({
  onAgregar,
}: {
  /** Da de alta la postulación; devuelve `true` si el servidor la confirmó. */
  onAgregar: (candidatoId: string) => Promise<boolean>;
}) {
  const [nombre, setNombre] = useState('');
  const [consultando, setConsultando] = useState(false);
  const [resultados, setResultados] = useState<Candidato[] | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [agregandoId, setAgregandoId] = useState<string | null>(null);

  const alBuscar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const consulta = nombre.trim();
    if (consulta.length === 0) {
      setErrorBusqueda('Escribe al menos un nombre para buscar');
      return;
    }
    setConsultando(true);
    setErrorBusqueda(null);
    try {
      const pagina = await solicitud<Pagina<Candidato>>(
        `/candidatos?q=${encodeURIComponent(consulta)}&page=1&limit=${LIMITE_BUSQUEDA}`,
      );
      setResultados(pagina.items);
    } catch {
      setErrorBusqueda('No se pudo buscar candidatos. Inténtalo de nuevo.');
      setResultados(null);
    } finally {
      setConsultando(false);
    }
  };

  const alElegir = async (candidato: Candidato) => {
    setAgregandoId(candidato.id);
    try {
      const ok = await onAgregar(candidato.id);
      if (ok) {
        // Éxito: se limpia la selección para el próximo alta.
        setResultados((anteriores) => anteriores?.filter((c) => c.id !== candidato.id) ?? null);
      }
      // Si `ok` es false, el store ya expone el motivo (p. ej. 409 «ya postula»).
    } finally {
      setAgregandoId(null);
    }
  };

  return (
    <form onSubmit={alBuscar} className="space-y-3" noValidate>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <label
            htmlFor="buscar-candidato"
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            Buscar candidato por nombre
          </label>
          <input
            id="buscar-candidato"
            value={nombre}
            onChange={(evento) => setNombre(evento.target.value)}
            placeholder="Nombres o apellidos"
            className={CLASE_CAMPO}
          />
        </div>
        <button type="submit" disabled={consultando} className={CLASE_BOTON_SECUNDARIO}>
          {consultando ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      {errorBusqueda !== null && <MensajeError mensaje={errorBusqueda} />}
      {consultando && <Spinner texto="Buscando candidatos…" />}

      {resultados !== null && !consultando && resultados.length === 0 && (
        <EstadoVacio mensaje="Sin candidatos que coincidan con la búsqueda." />
      )}

      {resultados !== null && resultados.length > 0 && (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {resultados.map((candidato) => (
            <li
              key={candidato.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span className="text-sm text-slate-200">
                {candidato.nombres} {candidato.apellidos}
                <span className="ml-2 text-xs text-slate-500">C.I. {candidato.cedula}</span>
              </span>
              <button
                type="button"
                disabled={agregandoId !== null}
                onClick={() => void alElegir(candidato)}
                className={CLASE_BOTON_PRINCIPAL}
              >
                {agregandoId === candidato.id ? 'Agregando…' : 'Agregar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
