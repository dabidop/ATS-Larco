import { Link } from 'react-router-dom';

/** Página 404 sencilla para rutas desconocidas. */
export function Pagina404() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
      <p className="text-sm font-semibold text-amber-400">Error 404</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-100">
        Página no encontrada
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        La ruta que buscas no existe en esta aplicación.
      </p>
      <Link
        to="/requerimientos"
        className="mt-4 inline-block text-sm font-semibold text-emerald-400 hover:text-emerald-300"
      >
        Volver a Requerimientos
      </Link>
    </div>
  );
}
