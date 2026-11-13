import { Outlet } from 'react-router-dom';

import { Header } from './Header';

/** Shell de la SPA autenticada: header + contenedor de la ruta activa. */
export function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header />
      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-4 sm:py-6">
        <Outlet />
      </main>
    </div>
  );
}
