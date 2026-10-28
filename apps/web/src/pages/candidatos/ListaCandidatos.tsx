import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { MENSAJE_CEDULA, PATRON_CEDULA } from '../../components/candidatos/FormularioCandidato';
import { CampoTexto } from '../../components/ui/campos';
import { EstadoVacio, MensajeError, Spinner } from '../../components/ui/feedback';
import { Paginacion } from '../../components/ui/datos';
import { CLASE_BOTON_PRINCIPAL, CLASE_BOTON_SECUNDARIO } from '../../components/ui/estilos';
import { dinero } from '../../lib/formato';
import { puedeGestionarCandidatos } from '../../lib/rbac';
import { solicitud } from '../../lib/api';
import { useRecurso } from '../../lib/useRecurso';
import { useSesionStore } from '../../store/sesion';
import type { Candidato, Pagina } from '../../tipos';

/** Tamaño de página fijo del listado (la API admite hasta 100). */
const LIMITE = 10;

/**
 * Listado paginado de candidatos (`GET /api/candidatos`) con búsqueda por
 * nombre (`q`, parcial) y por cédula (exacta). Cualquier rol autenticado
 * puede consultarlo; «Nuevo candidato» es de `analista_seleccion`,
 * `admin_rrhh` y `superusuario`.
 */
export function PaginaCandidatos() {
  const [valores, setValores] = useState({ q: '', cedula: '' });
  const [consulta, setConsulta] = useState({ q: '', cedula: '' });
  const [pagina, setPagina] = useState(1);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const rol = useSesionStore((sesion) => sesion.usuario?.role ?? null);

  const recurso = useRecurso<Pagina<Candidato>>(() => {
    const parametros = new URLSearchParams({ page: String(pagina), limit: String(LIMITE) });
    if (consulta.q.length > 0) parametros.set('q', consulta.q);
    if (consulta.cedula.length > 0) parametros.set('cedula', consulta.cedula);
    return solicitud<Pagina<Candidato>>(`/candidatos?${parametros.toString()}`);
  }, [pagina, consulta]);

  const alBuscar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const cedula = valores.cedula.trim();
    // La cédula del query es EXACTA y el backend exige el patrón: mejor avisar aquí.
    if (cedula.length > 0 && !PATRON_CEDULA.test(cedula)) {
      setErrorBusqueda(MENSAJE_CEDULA);
      return;
    }
    setErrorBusqueda(null);
    setConsulta({ q: valores.q.trim(), cedula });
    setPagina(1);
  };

  /** La búsqueda textual se aplica en cada tecla; la cédula sigue siendo exacta. */
  const alCambiarNombre = (q: string) => {
    setValores((anterior) => ({ ...anterior, q }));
    setConsulta((anterior) => ({ ...anterior, q: q.trim() }));
    setPagina(1);
  };

  const datos = recurso.datos;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Candidatos</h1>
        {puedeGestionarCandidatos(rol) && (
          <Link to="/candidatos/nuevo" className={CLASE_BOTON_PRINCIPAL}>
            Nuevo candidato
          </Link>
        )}
      </div>

      <form onSubmit={alBuscar} className="mb-4 flex flex-wrap items-end gap-3" noValidate>
        <div className="w-full max-w-xs">
          <CampoTexto
            etiqueta="Buscar por nombre"
            placeholder="Nombre, apellido, ciudad o cargo"
            valor={valores.q}
            onCambio={alCambiarNombre}
          />
        </div>
        <div className="w-full max-w-[180px]">
          <CampoTexto
            etiqueta="Cédula (exacta)"
            inputMode="numeric"
            valor={valores.cedula}
            onCambio={(valor) => setValores((anterior) => ({ ...anterior, cedula: valor }))}
            error={errorBusqueda ?? undefined}
          />
        </div>
        <button type="submit" className={CLASE_BOTON_SECUNDARIO}>
          Buscar
        </button>
      </form>

      {recurso.fase === 'cargando' && datos === null && <Spinner texto="Cargando candidatos…" />}
      {recurso.fase === 'error' && (
        <MensajeError
          mensaje={recurso.error ?? 'No se pudieron cargar los candidatos'}
          onReintentar={recurso.recargar}
        />
      )}
      {recurso.fase === 'listo' && datos !== null && datos.items.length === 0 && (
        <EstadoVacio mensaje="Sin resultados: no hay candidatos que coincidan con la búsqueda." />
      )}

      {recurso.fase === 'listo' && datos !== null && datos.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Candidato
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Cédula
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Ciudad
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Cargo actual
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Expectativa
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {datos.items.map((candidato) => (
                  <tr key={candidato.id} className="hover:bg-slate-900/60">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        to={`/candidatos/${candidato.id}`}
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        {candidato.nombres} {candidato.apellidos}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{candidato.cedula}</td>
                    <td className="px-4 py-3 text-slate-300">{candidato.email ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{candidato.ciudad ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{candidato.cargoActual ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {dinero(candidato.expectativaSalarial)}
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
