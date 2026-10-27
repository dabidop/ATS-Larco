import { Link } from 'react-router-dom';

/**
 * Logotipo «larco» arriba-izquierda (Etapa 9: la muestra lleva el logo de
 * LARCO y el subtítulo «Gestión Humana / Applicant Tracking System»).
 *
 * Es un wordmark CSS (texto + dos acentos de color) y NO una imagen: así
 * escala con la tipografía del sistema, no pide red y se adapta al tema
 * oscuro de la app sin assets externos. Enlaza al Dashboard (o a
 * Requerimientos cuando el rol no puede ver el dashboard).
 */
export function LogoLarco({ destino }: { destino: string }) {
  return (
    <Link
      to={destino}
      aria-label="LARCO — Gestión Humana, ir al inicio"
      className="flex items-center gap-3 transition hover:opacity-90"
    >
      {/* Wordmark: «larco» en minúsculas con el acento superior de la «o». */}
      <span className="relative inline-flex items-end">
        <span className="text-2xl leading-none font-bold tracking-tight text-white lowercase">
          larco
        </span>
        <span aria-hidden="true" className="absolute -top-1 -right-1.5 flex gap-0.5">
          <span className="block h-1.5 w-1.5 rounded-[1px] bg-amber-500" />
          <span className="block h-1.5 w-1.5 rounded-[1px] bg-emerald-500" />
        </span>
      </span>
      <span aria-hidden="true" className="hidden h-8 w-px bg-slate-700 sm:block" />
      <span className="hidden leading-tight sm:block">
        <span className="block text-xs font-semibold tracking-wide text-amber-500 uppercase">
          Gestión Humana
        </span>
        <span className="block text-[10px] text-slate-400">Applicant Tracking System</span>
      </span>
    </Link>
  );
}
