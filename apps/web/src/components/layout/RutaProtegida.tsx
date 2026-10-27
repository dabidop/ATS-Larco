import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useSesionStore } from '../../store/sesion';

/**
 * Guard de rutas protegidas: sin token no se entra, y la ruta original se
 * conserva en `location.state.from` para volver a ella tras el login.
 *
 * También es el MECANISMO de redirección ante un 401: `lib/api.ts` descarta
 * la sesión en el store y, como este componente está suscrito, la siguiente
 * renderización redirige a `/login` sin necesidad de tocar el history a mano.
 *
 * Rol opcional (`rolPermitido`): si se pasa (un rol o una lista de roles) y
 * el rol de la sesión no está en la lista, se redirige a `/dashboard` (la
 * página inicial desde la Etapa 9). Patrones: `/usuarios` y `/bitacora`
 * exclusivos del `superusuario`; `/entrevistas` e `/importar` de
 * analista/admin/superusuario. Sin la prop el comportamiento es EXACTAMENTE
 * el original: solo se exige token.
 */
export function RutaProtegida({
  rolPermitido,
}: { rolPermitido?: string | readonly string[] } = {}) {
  const token = useSesionStore((estado) => estado.token);
  const rol = useSesionStore((estado) => estado.usuario?.role ?? null);
  const ubicacion = useLocation();

  if (token === null) {
    return <Navigate to="/login" replace state={{ from: ubicacion }} />;
  }
  if (rolPermitido !== undefined && !permitido(rol, rolPermitido)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

/** ¿`rol` está en la lista de roles permitidos? */
function permitido(rol: string | null, permitidos: string | readonly string[]): boolean {
  if (typeof permitidos === 'string') return rol === permitidos;
  return rol !== null && permitidos.includes(rol);
}
