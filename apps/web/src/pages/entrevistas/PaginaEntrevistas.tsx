import { useState } from 'react';

import { mensajeDeError, solicitud } from '../../lib/api';
import { fechaCorta, fechaHora } from '../../lib/formato';
import { useRecurso } from '../../lib/useRecurso';
import { ESTADOS_ENTREVISTA, type Entrevista, type EstadoEntrevista } from '../../tipos';
import { CalendarioEntrevistas } from '../../components/entrevistas/CalendarioEntrevistas';
import { DialogoAgendar } from '../../components/entrevistas/DialogoAgendar';
import { EstadoVacio, MensajeError, Spinner } from '../../components/ui/feedback';
import { ContenedorDesplazable } from '../../components/ui/datos';
import { CLASE_BOTON_PRINCIPAL, CLASE_CAMPO, CLASE_ETIQUETA } from '../../components/ui/estilos';

/**
 * Agenda de entrevistas (`/entrevistas`, Etapa 9): listado con filtros de
 * estado y de fechas (los resuelve la API: `GET /api/entrevistas?estado=…&desde=…`),
 * alta vía `DialogoAgendar` (POST sobre una postulación activa) y cambio de
 * estado por fila (PATCH: agendada → realizada / cancelada).
 *
 * Además PINTA `CalendarioEntrevistas` (corrección posterior a la Etapa 9):
 * la vista mensual con las entrevistas del mes y su estado, autónoma respecto
 * de los filtros de la tabla.
 */

/** Badge de color por estado de la entrevista. */
const CLASES_ESTADO: Readonly<Record<EstadoEntrevista, string>> = {
  agendada: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  realizada: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  cancelada: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
};

/** Nombre legible de cada estado (badges y opciones del select). */
const ETIQUETA_ESTADO_ENTREVISTA: Readonly<Record<EstadoEntrevista, string>> = {
  agendada: 'Agendada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
};

/** Fila de la agenda; el select cambia el estado vía PATCH. */
function FilaEntrevista({
  entrevista,
  onCambiada,
}: {
  entrevista: Entrevista;
  onCambiada: (actualizada: Entrevista) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estadoPendiente, setEstadoPendiente] = useState<EstadoEntrevista | null>(null);

  const cambiarEstado = async (estado: EstadoEntrevista) => {
    setEnviando(true);
    setError(null);
    try {
      const actualizada = await solicitud<Entrevista>(`/entrevistas/${entrevista.id}`, {
        metodo: 'PATCH',
        cuerpo: { estado },
      });
      onCambiada(actualizada);
    } catch (capturado) {
      setError(mensajeDeError(capturado, 'No se pudo actualizar la entrevista'));
    } finally {
      setEnviando(false);
      setEstadoPendiente(null);
    }
  };

  const estadoActual = (ESTADOS_ENTREVISTA as readonly string[]).includes(entrevista.estado)
    ? (entrevista.estado as EstadoEntrevista)
    : 'agendada';

  return (
    <>
      <tr className="border-t border-slate-800 align-top">
        <td className="px-3 py-2 text-sm whitespace-nowrap text-slate-200">
          {fechaCorta(entrevista.fecha)}
          {entrevista.hora !== null && (
            <span className="ml-2 text-slate-400">{entrevista.hora}</span>
          )}
        </td>
        <td className="px-3 py-2 text-sm text-slate-100">
          {entrevista.candidato.nombre}
          <span className="mt-0.5 block text-xs text-slate-500">
            {entrevista.requerimiento.codigo} — {entrevista.requerimiento.titulo}
          </span>
        </td>
        <td className="px-3 py-2 text-sm text-slate-300">{entrevista.tipo}</td>
        <td className="px-3 py-2 text-sm text-slate-300">{entrevista.entrevistador ?? '—'}</td>
        <td className="px-3 py-2 text-sm">
          <span
            className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${CLASES_ESTADO[estadoActual]}`}
          >
            {ETIQUETA_ESTADO_ENTREVISTA[estadoActual]}
          </span>
        </td>
        <td className="px-3 py-2 text-sm">
          <select
            aria-label={`Estado de la entrevista de ${entrevista.candidato.nombre}`}
            value={estadoActual}
            disabled={enviando}
            onChange={(evento) => setEstadoPendiente(evento.target.value as EstadoEntrevista)}
            className={CLASE_CAMPO}
          >
            {ESTADOS_ENTREVISTA.map((estado) => (
              <option key={estado} value={estado}>
                {ETIQUETA_ESTADO_ENTREVISTA[estado]}
              </option>
            ))}
          </select>
          {error !== null && <p className="mt-1 text-xs text-rose-400">{error}</p>}
        </td>
        <td className="px-3 py-2 text-xs text-slate-500">{fechaHora(entrevista.actualizadoEn)}</td>
      </tr>
      {estadoPendiente !== null && estadoPendiente !== estadoActual && (
        <tr>
          <td colSpan={7}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={`confirmar-estado-${entrevista.id}`}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            >
              <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
                <h2
                  id={`confirmar-estado-${entrevista.id}`}
                  className="text-base font-semibold text-slate-100"
                >
                  Confirmar actualización
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  ¿Confirmas cambiar el estado de la entrevista de{' '}
                  <strong>{entrevista.candidato.nombre}</strong> a{' '}
                  <strong>{ETIQUETA_ESTADO_ENTREVISTA[estadoPendiente]}</strong>?
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={enviando}
                    onClick={() => void cambiarEstado(estadoPendiente)}
                    className={CLASE_BOTON_PRINCIPAL}
                  >
                    {enviando ? 'Guardando…' : 'Confirmar'}
                  </button>
                  <button
                    type="button"
                    disabled={enviando}
                    onClick={() => setEstadoPendiente(null)}
                    className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function PaginaEntrevistas() {
  const [filtroEstado, setFiltroEstado] = useState<EstadoEntrevista | ''>('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const recurso = useRecurso<Entrevista[]>(() => {
    const parametros = new URLSearchParams();
    if (filtroEstado !== '') parametros.set('estado', filtroEstado);
    if (filtroDesde !== '') parametros.set('desde', filtroDesde);
    if (filtroHasta !== '') parametros.set('hasta', filtroHasta);
    const query = parametros.toString();
    return solicitud<Entrevista[]>(`/entrevistas${query.length > 0 ? `?${query}` : ''}`);
  }, [filtroEstado, filtroDesde, filtroHasta]);

  const entrevistas = recurso.datos ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">Entrevistas</h1>
          <p className="mt-1 text-sm text-slate-400">
            Agenda de entrevistas y psicotécnicas de los candidatos en proceso.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMostrarAlta((anterior) => !anterior)}
          className={`${CLASE_BOTON_PRINCIPAL} w-full sm:w-auto`}
        >
          {mostrarAlta ? 'Ocultar formulario' : '+ Agendar entrevista'}
        </button>
      </div>

      {aviso !== null && (
        <p
          role="status"
          className="rounded-lg border border-emerald-700/60 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200"
        >
          {aviso}
        </p>
      )}

      {/* Filtros de la agenda (resueltos por la API). */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-44">
          <label htmlFor="filtro-estado" className={CLASE_ETIQUETA}>
            Estado
          </label>
          <select
            id="filtro-estado"
            value={filtroEstado}
            onChange={(evento) => setFiltroEstado(evento.target.value as EstadoEntrevista | '')}
            className={CLASE_CAMPO}
          >
            <option value="">(todas)</option>
            {ESTADOS_ENTREVISTA.map((estado) => (
              <option key={estado} value={estado}>
                {ETIQUETA_ESTADO_ENTREVISTA[estado]}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor="filtro-desde" className={CLASE_ETIQUETA}>
            Desde
          </label>
          <input
            id="filtro-desde"
            type="date"
            value={filtroDesde}
            onChange={(evento) => setFiltroDesde(evento.target.value)}
            className={CLASE_CAMPO}
          />
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor="filtro-hasta" className={CLASE_ETIQUETA}>
            Hasta
          </label>
          <input
            id="filtro-hasta"
            type="date"
            value={filtroHasta}
            onChange={(evento) => setFiltroHasta(evento.target.value)}
            className={CLASE_CAMPO}
          />
        </div>
      </div>

      {/* Vista mensual con los estados: trae SUS datos (desde/hasta del mes). */}
      <CalendarioEntrevistas />

      {recurso.fase === 'cargando' && entrevistas.length === 0 && (
        <Spinner texto="Cargando agenda…" />
      )}
      {recurso.fase === 'error' && entrevistas.length === 0 && (
        <MensajeError
          mensaje={recurso.error ?? 'No se pudo cargar la agenda'}
          onReintentar={recurso.recargar}
        />
      )}
      {recurso.fase === 'listo' && entrevistas.length === 0 && (
        <EstadoVacio mensaje="Sin entrevistas registradas con estos filtros" />
      )}

      {entrevistas.length > 0 && (
        <ContenedorDesplazable etiqueta="Tabla de entrevistas">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-slate-900/70">
              <tr>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Fecha</th>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Candidato / requerimiento</th>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Tipo</th>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Entrevistador</th>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Estado</th>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Acciones</th>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Actualizada</th>
              </tr>
            </thead>
            <tbody>
              {entrevistas.map((entrevista) => (
                <FilaEntrevista
                  key={entrevista.id}
                  entrevista={entrevista}
                  onCambiada={(actualizada) => {
                    setAviso(
                      `Entrevista de ${actualizada.candidato.nombre}: ` +
                        `${ETIQUETA_ESTADO_ENTREVISTA[actualizada.estado as EstadoEntrevista] ?? actualizada.estado}`,
                    );
                    recurso.recargar();
                  }}
                />
              ))}
            </tbody>
          </table>
        </ContenedorDesplazable>
      )}

      {mostrarAlta && (
        <DialogoAgendar
          onCreada={(creada) => {
            setMostrarAlta(false);
            setAviso(
              `Entrevista agendada: ${creada.candidato.nombre} — ${fechaCorta(creada.fecha)}`,
            );
            recurso.recargar();
          }}
          onCerrar={() => setMostrarAlta(false)}
        />
      )}
    </div>
  );
}
