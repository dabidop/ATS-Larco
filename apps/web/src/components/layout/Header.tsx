import { NavLink, useNavigate } from 'react-router-dom';

import { cerrarSesionEnServidor } from '../../lib/api';
import {
  etiquetaRol,
  puedeVerSeccionBitacora,
  puedeVerSeccionCandidatos,
  puedeVerSeccionDashboard,
  puedeVerSeccionDepartamentos,
  puedeVerSeccionEntrevistas,
  puedeVerSeccionImportar,
  puedeVerSeccionRequerimientos,
  puedeVerSeccionUsuarios,
} from '../../lib/rbac';
import { useSesionStore } from '../../store/sesion';
import { CLASE_BOTON_SECUNDARIO } from '../ui/estilos';
import { LogoLarco } from './LogoLarco';

/**
 * Barra superior: identidad de la app, navegación CONDICIONADA por el rol
 * (predicados de `lib/rbac.ts`) y, a la derecha, el usuario + «Salir».
 *
 * Recordatorio de seguridad: ocultar enlaces es ergonomía; la autorización
 * real la aplican los guards de la API, que devuelven 403 si alguien llega
 * a un endpoint para el que no tiene rol.
 */
export function Header() {
  const usuario = useSesionStore((estado) => estado.usuario);
  const cerrarSesionLocal = useSesionStore((estado) => estado.cerrarSesion);
  const navegar = useNavigate();
  const rol = usuario?.role ?? null;

  const secciones = [
    { destino: '/dashboard', etiqueta: 'Dashboard', visible: puedeVerSeccionDashboard(rol) },
    {
      destino: '/requerimientos',
      etiqueta: 'Requerimientos',
      visible: puedeVerSeccionRequerimientos(rol),
    },
    { destino: '/candidatos', etiqueta: 'Candidatos', visible: puedeVerSeccionCandidatos(rol) },
    { destino: '/importar', etiqueta: 'Importar HVs', visible: puedeVerSeccionImportar(rol) },
    {
      destino: '/departamentos',
      etiqueta: 'Departamentos',
      visible: puedeVerSeccionDepartamentos(rol),
    },
    { destino: '/entrevistas', etiqueta: 'Entrevistas', visible: puedeVerSeccionEntrevistas(rol) },
    { destino: '/bitacora', etiqueta: 'Bitácora', visible: puedeVerSeccionBitacora(rol) },
    { destino: '/usuarios', etiqueta: 'Usuarios', visible: puedeVerSeccionUsuarios(rol) },
  ].filter((seccion) => seccion.visible);

  const alSalir = () => {
    // Best-effort en el servidor (solo auditoría) y cierre local SIEMPRE.
    void cerrarSesionEnServidor();
    cerrarSesionLocal();
    navegar('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <LogoLarco destino={puedeVerSeccionDashboard(rol) ? '/dashboard' : '/requerimientos'} />
        <nav aria-label="Secciones principales" className="flex flex-wrap gap-4">
          {secciones.map((seccion) => (
            <NavLink
              key={seccion.destino}
              to={seccion.destino}
              className={({ isActive }) =>
                `text-sm transition ${
                  isActive
                    ? 'font-semibold text-emerald-400'
                    : 'text-slate-300 hover:text-slate-100'
                }`
              }
            >
              {seccion.etiqueta}
            </NavLink>
          ))}
          {secciones.length === 0 && (
            <span className="text-sm text-amber-400">
              Tu rol no tiene secciones habilitadas. Contacta con RRHH.
            </span>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {usuario?.email ?? 'Sesión iniciada'}
            {usuario?.role ? ` · ${etiquetaRol(usuario.role)}` : ''}
          </span>
          <button type="button" onClick={alSalir} className={CLASE_BOTON_SECUNDARIO}>
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
