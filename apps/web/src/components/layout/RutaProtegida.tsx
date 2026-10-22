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
 * Rol opcional (`rolPermitido`): si se pasa y el rol de la sesión no coincide,
 * se redirige a `/requerimientos` (patrón de la ruta `/usuarios`, exclusiva
 * del `superusuario`). Sin la prop el comportamiento es EXACTAMENTE el
 * original: solo se exige token.
 */
export function RutaProtegida({ rolPermitido }: { rolPermitido?: string } = {}) {
  const token = useSesionStore((estado) => estado.token);
  const rol = useSesionStore((estado) => estado.usuario?.role ?? null);
  const ubicacion = useLocation();

  if (token === null) {
    return <Navigate to="/login" replace state={{ from: ubicacion }} />;
  }
  if (rolPermitido !== undefined && rol !== rolPermitido) {
    return <Navigate to="/requerimientos" replace />;
  }
  return <Outlet />;
}
