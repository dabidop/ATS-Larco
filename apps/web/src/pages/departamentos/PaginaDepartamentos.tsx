import { useState } from 'react';

import { mensajeDeError, solicitud } from '../../lib/api';
import { puedeEditarDepartamento } from '../../lib/rbac';
import { useRecurso } from '../../lib/useRecurso';
import { useSesionStore } from '../../store/sesion';
import type { Departamento } from '../../tipos';
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
  onGuardado,
}: {
  departamento: Departamento;
  editable: boolean;
  onGuardado: (actualizado: Departamento) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [coordinador, setCoordinador] = useState(departamento.coordinador);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const guardar = async () => {
    const limpio = coordinador.trim();
    if (limpio.length < 3) {
      setError('coordinador debe tener al menos 3 caracteres');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const actualizado = await solicitud<Departamento>(`/departamentos/${departamento.id}`, {
        metodo: 'PATCH',
        cuerpo: { coordinador: limpio },
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
          <div className="flex items-center gap-2">
            <input
              aria-label={`Coordinador de ${departamento.nombre}`}
              value={coordinador}
              onChange={(evento) => setCoordinador(evento.target.value)}
              className={error === undefined ? CLASE_CAMPO : `${CLASE_CAMPO} border-rose-500/70`}
            />
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
                setCoordinador(departamento.coordinador);
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
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left">
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
                  onGuardado={(actualizado) => {
                    setAviso(`Coordinador de ${actualizado.nombre} actualizado`);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
