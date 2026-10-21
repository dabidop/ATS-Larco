import { useNavigate } from 'react-router-dom';

import { solicitud } from '../../lib/api';
import { puedeGestionarRequerimientos } from '../../lib/rbac';
import { useSesionStore } from '../../store/sesion';
import type { Requerimiento, RequerimientoNuevo } from '../../tipos';
import { FormularioRequerimiento } from '../../components/requerimientos/FormularioRequerimiento';

/**
 * Alta de requerimientos (`POST /api/requerimientos`) con las 5 secciones.
 * Solo `admin_rrhh` y `lider_area` pueden crear; el botón y el propio envío
 * se condicionan con el mismo predicado (el backend respondería 403 igual).
 */
export function PaginaNuevoRequerimiento() {
  const navegar = useNavigate();
  const rol = useSesionStore((sesion) => sesion.usuario?.role ?? null);

  const alGuardar = async (cuerpo: RequerimientoNuevo) => {
    const creado = await solicitud<Requerimiento>('/requerimientos', {
      metodo: 'POST',
      cuerpo,
    });
    navegar(`/requerimientos/${creado.id}`);
  };

  if (!puedeGestionarRequerimientos(rol)) {
    return (
      <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-6 text-sm text-amber-200">
        Tu rol no puede crear requerimientos: pide el alta a RRHH o a tu líder de área.
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold tracking-tight text-slate-100">Nuevo requerimiento</h1>
      <FormularioRequerimiento textoGuardar="Crear requerimiento" onGuardar={alGuardar} />
    </div>
  );
}
