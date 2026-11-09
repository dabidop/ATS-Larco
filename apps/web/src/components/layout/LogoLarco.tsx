import { Link } from 'react-router-dom';

import logoLarco from '../../assets/images/larcoLogoNegro.png';

/**
 * Logotipo «larco» arriba-izquierda (Etapa 9: la muestra lleva el logo de
 * LARCO y el subtítulo «Gestión Humana / Applicant Tracking System»).
 *
 * Usa el logotipo oficial local. Enlaza al Dashboard (o a Requerimientos
 * cuando el rol no puede ver el dashboard).
 */
export function LogoLarco({ destino }: { destino: string }) {
  return (
    <Link
      to={destino}
      aria-label="LARCO — Gestión Humana, ir al inicio"
      className="flex cursor-pointer items-center gap-3"
    >
      <img src={logoLarco} alt="LARCO" className="h-10 w-auto mix-blend-screen" />
      <span aria-hidden="true" className="hidden h-8 w-px bg-slate-700 sm:block" />
      <span className="hidden leading-tight sm:block">
        <span className="block text-xs font-semibold tracking-wide text-pink-500 uppercase">
          Gestión Humana
        </span>
        <span className="block text-[10px] text-slate-400">Applicant Tracking System</span>
      </span>
    </Link>
  );
}
