import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/layout/Layout';
import { RutaProtegida } from './components/layout/RutaProtegida';
import { Pagina404 } from './pages/NoEncontrada';
import { PaginaCandidatos } from './pages/candidatos/ListaCandidatos';
import { PaginaDetalleCandidato } from './pages/candidatos/DetalleCandidato';
import { PaginaNuevoCandidato } from './pages/candidatos/NuevoCandidato';
import { PaginaLogin } from './pages/Login';
import { PaginaDetalleRequerimiento } from './pages/requerimientos/DetalleRequerimiento';
import { PaginaRequerimientos } from './pages/requerimientos/ListaRequerimientos';
import { PaginaNuevoRequerimiento } from './pages/requerimientos/NuevoRequerimiento';

/**
 * Árbol de rutas (modo declarativo de react-router-dom).
 *
 *  - `/login`                        → pública (si ya hay sesión, redirige).
 *  - `/*` con `RutaProtegida`        → exige token; sin él → `/login` dejando
 *    la ruta original en `location.state.from`.
 *  - Dentro, el `Layout` aporta header + navegación por rol.
 *  - `/` → redirect a `/requerimientos`; cualquier otra ruta → 404.
 *
 * NO hay rutas de embudo/canvas (kanban): llegan en la parte 2.
 */
export function RutasAplicacion() {
  return (
    <Routes>
      <Route path="/login" element={<PaginaLogin />} />
      <Route element={<RutaProtegida />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/requerimientos" replace />} />
          <Route path="requerimientos" element={<PaginaRequerimientos />} />
          <Route path="requerimientos/nuevo" element={<PaginaNuevoRequerimiento />} />
          <Route path="requerimientos/:id" element={<PaginaDetalleRequerimiento />} />
          <Route path="candidatos" element={<PaginaCandidatos />} />
          <Route path="candidatos/nuevo" element={<PaginaNuevoCandidato />} />
          <Route path="candidatos/:id" element={<PaginaDetalleCandidato />} />
          <Route path="*" element={<Pagina404 />} />
        </Route>
      </Route>
    </Routes>
  );
}

/** Shell completo con el router de navegador (lo usa `main.tsx`). */
export function App() {
  return (
    <BrowserRouter>
      <RutasAplicacion />
    </BrowserRouter>
  );
}

export default App;
