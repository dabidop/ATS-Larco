import { useEffect, useState } from 'react';

import { mensajeDeError, solicitud } from '../../lib/api';
import { puedeEditarDepartamento } from '../../lib/rbac';
import { useRecurso } from '../../lib/useRecurso';
import { useSesionStore } from '../../store/sesion';
import type { CoordinadorDisponible, Departamento } from '../../tipos';
import { ContenedorDesplazable } from '../../components/ui/datos';
import { AvisoExito, EstadoVacio, MensajeError, Spinner } from '../../components/ui/feedback';
import {
  CLASE_BOTON_PRINCIPAL,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CAMPO,
  CLASE_ETIQUETA,
} from '../../components/ui/estilos';

/**
 * Áreas LARCO (`/departamentos`, Etapa 9): catálogo SEMBRADO por la migración
 * 009 (no se crean ni borran áreas) con sus estadísticas de embudo.
 *
 * El único gestable es el COORDINADOR (`PATCH /:id`, solo `admin_rrhh` y
 * `superusuario`); el resto de roles solo consulta (`GET` autenticado).
 */

/** Fila de la tabla; en modo edición el coordinador vuelve a campo de texto. */
function FilaDepartamento({
  departamento,
  editable,
  coordinadores,
  onGuardado,
}: {
  departamento: Departamento;
  editable: boolean;
  coordinadores: CoordinadorDisponible[];
  onGuardado: (actualizado: Departamento) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [coordinadorId, setCoordinadorId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const coordinadoresDisponibles = coordinadores;

  useEffect(() => {
    const actual = coordinadoresDisponibles.find(
      (opcion) => opcion.nombre === departamento.coordinador,
    );
    setCoordinadorId(actual?.id ?? '');
  }, [coordinadoresDisponibles, departamento.coordinador]);

  const guardar = async () => {
    const seleccionado = coordinadoresDisponibles.find((opcion) => opcion.id === coordinadorId);
    if (seleccionado === undefined) {
      setError('Selecciona un líder activo');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const actualizado = await solicitud<Departamento>(`/departamentos/${departamento.id}`, {
        metodo: 'PATCH',
        cuerpo: { coordinadorId: seleccionado.id },
      });
      onGuardado(actualizado);
      setEditando(false);
    } catch (capturado) {
      setError(mensajeDeError(capturado, 'No se pudo guardar el coordinador'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <tr className="border-t border-slate-800">
      <td className="px-3 py-2 text-sm font-medium text-slate-100">{departamento.nombre}</td>
      <td className="px-3 py-2 text-sm text-slate-300">
        {editando ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Coordinador de ${departamento.nombre}`}
              value={coordinadorId}
              onChange={(evento) => {
                const id = evento.target.value;
                setCoordinadorId(id);
              }}
              className={error === null ? CLASE_CAMPO : `${CLASE_CAMPO} border-rose-500/70`}
            >
              <option value="">Selecciona un líder</option>
              {coordinadoresDisponibles.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.nombre} · {opcion.email} · {opcion.jefatura ?? 'Sin departamento'}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={enviando}
              onClick={() => void guardar()}
              className={CLASE_BOTON_PRINCIPAL}
            >
              {enviando ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCoordinadorId('');
                setError(null);
                setEditando(false);
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <span>
            {departamento.coordinador}
            {editable && (
              <button
                type="button"
                onClick={() => setEditando(true)}
                className="ml-3 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
              >
                Editar coordinador
              </button>
            )}
          </span>
        )}
        {error !== null && <p className="mt-1 text-xs text-rose-400">{error}</p>}
      </td>
      <td className="px-3 py-2 text-sm text-slate-200">{departamento.totalCandidatos}</td>
      <td className="px-3 py-2 text-sm text-slate-200">{departamento.totalRequerimientos}</td>
      <td className="px-3 py-2 text-sm">
        <span className="rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-300">
          {departamento.requerimientosAprobados} aprob.
        </span>
      </td>
    </tr>
  );
}

export function PaginaDepartamentos() {
  const rol = useSesionStore((sesion) => sesion.usuario?.role ?? null);
  const editable = puedeEditarDepartamento(rol);
  const [aviso, setAviso] = useState<string | null>(null);

  const recurso = useRecurso<Departamento[]>(() => solicitud<Departamento[]>('/departamentos'), []);
  const recursoCoordinadores = useRecurso<CoordinadorDisponible[]>(
    () =>
      editable
        ? solicitud<CoordinadorDisponible[]>('/departamentos/coordinadores')
        : Promise.resolve([]),
    [editable],
  );

  if (recurso.fase === 'cargando' && recurso.datos === null) {
    return <Spinner texto="Cargando departamentos…" />;
  }
  if (recurso.fase === 'error' || recurso.datos === null) {
    return (
      <MensajeError
        mensaje={recurso.error ?? 'No se pudieron cargar los departamentos'}
        onReintentar={recurso.recargar}
      />
    );
  }

  const departamentos = recurso.datos;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Departamentos</h1>
        <p className="mt-1 text-sm text-slate-400">
          Áreas LARCO con su coordinador y sus cifras de embudo.
        </p>
      </div>

      {aviso !== null && <AvisoExito mensaje={aviso} />}

      {departamentos.length === 0 ? (
        <EstadoVacio mensaje="Sin departamentos registrados" />
      ) : (
        <ContenedorDesplazable etiqueta="Tabla de departamentos">
          <table className="w-full min-w-[680px] text-left">
            <thead className="bg-slate-900/70">
              <tr>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Departamento</th>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Coordinador</th>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Candidatos</th>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Requerimientos</th>
                <th className={`px-3 py-2 ${CLASE_ETIQUETA}`}>Aprobados</th>
              </tr>
            </thead>
            <tbody>
              {departamentos.map((departamento) => (
                <FilaDepartamento
                  key={departamento.id}
                  departamento={departamento}
                  editable={editable}
                  coordinadores={recursoCoordinadores.datos ?? []}
                  onGuardado={(actualizado) => {
                    setAviso(`Coordinador de ${actualizado.nombre} actualizado`);
                  }}
                />
              ))}
            </tbody>
          </table>
        </ContenedorDesplazable>
      )}
    </div>
  );
}
