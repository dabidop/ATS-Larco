import { useState } from 'react';
import { Link } from 'react-router-dom';

import { solicitud } from '../../lib/api';
import { fechaCorta } from '../../lib/formato';
import { puedeGestionarRequerimientos } from '../../lib/rbac';
import { useRecurso } from '../../lib/useRecurso';
import { useSesionStore } from '../../store/sesion';
import { ESTADOS_REQUERIMIENTO } from '../../tipos';
import type { EstadoRequerimiento, Pagina, Requerimiento } from '../../tipos';
import { BadgeEstado, BadgeUrgencia, Paginacion } from '../../components/ui/datos';
import { EstadoVacio, MensajeError, Spinner } from '../../components/ui/feedback';
import { CLASE_BOTON_PRINCIPAL, CLASE_CAMPO, CLASE_ETIQUETA } from '../../components/ui/estilos';

/** Tamaño de página fijo para el listado (la API admite hasta 100). */
const LIMITE = 10;

/**
 * Listado paginado de requerimientos (`GET /api/requerimientos`), con filtro
 * por estado. Cualquier rol autenticado puede verlo; el botón «Nuevo» solo
 * aparece para `admin_rrhh`, `superusuario` y `lider_area`.
 */
export function PaginaRequerimientos() {
  const [pagina, setPagina] = useState(1);
  const [estado, setEstado] = useState<EstadoRequerimiento | ''>('');
  const rol = useSesionStore((sesion) => sesion.usuario?.role ?? null);

  const recurso = useRecurso<Pagina<Requerimiento>>(() => {
    const parametros = new URLSearchParams({ page: String(pagina), limit: String(LIMITE) });
    if (estado.length > 0) parametros.set('estado', estado);
    return solicitud<Pagina<Requerimiento>>(`/requerimientos?${parametros.toString()}`);
  }, [pagina, estado]);

  const datos = recurso.datos;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Requerimientos</h1>
        {puedeGestionarRequerimientos(rol) && (
          <Link to="/requerimientos/nuevo" className={CLASE_BOTON_PRINCIPAL}>
            Nuevo requerimiento
          </Link>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <label htmlFor="filtro-estado" className={CLASE_ETIQUETA}>
            Filtrar por estado
          </label>
          <select
            id="filtro-estado"
            className={CLASE_CAMPO}
            value={estado}
            onChange={(evento) => {
              // Cambiar de filtro vuelve a la página 1 (si no, podría quedar vacía).
              setEstado(evento.target.value as EstadoRequerimiento | '');
              setPagina(1);
            }}
          >
            <option value="">Todos los estados</option>
            {ESTADOS_REQUERIMIENTO.map((valor) => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </select>
        </div>
      </div>

      {recurso.fase === 'cargando' && datos === null && (
        <Spinner texto="Cargando requerimientos…" />
      )}
      {recurso.fase === 'error' && (
        <MensajeError
          mensaje={recurso.error ?? 'No se pudieron cargar los requerimientos'}
          onReintentar={recurso.recargar}
        />
      )}

      {recurso.fase === 'listo' && datos !== null && datos.items.length === 0 && (
        <EstadoVacio mensaje="Sin resultados: no hay requerimientos que cumplan el filtro." />
      )}

      {recurso.fase === 'listo' && datos !== null && datos.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Código
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Título
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Jefatura
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Prioridad
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Estado
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Creado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {datos.items.map((requerimiento) => (
                  <tr key={requerimiento.id} className="hover:bg-slate-900/60">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        to={`/requerimientos/${requerimiento.id}`}
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        {requerimiento.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-100">{requerimiento.titulo}</td>
                    <td className="px-4 py-3 text-slate-300">{requerimiento.jefatura}</td>
                    <td className="px-4 py-3">
                      <BadgeUrgencia urgencia={requerimiento.urgencia} />
                    </td>
                    <td className="px-4 py-3">
                      <BadgeEstado estado={requerimiento.estado} />
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {fechaCorta(requerimiento.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacion
            pagina={datos.page}
            total={datos.total}
            limit={datos.limit}
            onCambio={setPagina}
          />
        </>
      )}
    </div>
  );
}
