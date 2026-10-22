import { Link, useNavigate } from 'react-router-dom';

import { solicitud } from '../../lib/api';
import { puedeGestionarCandidatos } from '../../lib/rbac';
import { useSesionStore } from '../../store/sesion';
import type { Candidato, CandidatoNuevo } from '../../tipos';
import { FormularioCandidato } from '../../components/candidatos/FormularioCandidato';

/**
 * Alta de candidatos (`POST /api/candidatos`). Solo `analista_seleccion`,
 * `admin_rrhh` y `superusuario` pueden crear; el backend respondería 403
 * igualmente.
 */
export function PaginaNuevoCandidato() {
  const navegar = useNavigate();
  const rol = useSesionStore((sesion) => sesion.usuario?.role ?? null);

  const alGuardar = async (cuerpo: CandidatoNuevo) => {
    const creado = await solicitud<Candidato>('/candidatos', { metodo: 'POST', cuerpo });
    navegar(`/candidatos/${creado.id}`);
  };

  if (!puedeGestionarCandidatos(rol)) {
    return (
      <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-6 text-sm text-amber-200">
        Tu rol no puede registrar candidatos: pide el alta al equipo de Selección o a RRHH.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          to="/candidatos"
          className="text-sm font-semibold text-emerald-400 hover:text-emerald-300"
        >
          ← Volver
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Nuevo candidato</h1>
      </div>
      <FormularioCandidato textoGuardar="Crear candidato" onGuardar={alGuardar} />
    </div>
  );
}
