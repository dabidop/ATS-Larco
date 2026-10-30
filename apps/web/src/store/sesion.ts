import { create } from 'zustand';

import type { UsuarioSesion } from '../tipos';

/**
 * Almacén de sesión (Zustand). En producción el token vive únicamente en una
 * cookie HttpOnly; el valor `cookie` es un marcador visual, no una credencial.
 *
 * CLAVE DE PERSISTENCIA: `ats.sesion.v1` — el prefijo evita colisiones con
 * otras apps servidas en el mismo origen y el `.v1` permite invalidar todo lo
 * guardado si algún día cambia la forma del valor.
 *
 * Compatibilidad legacy — los tests/integraciones pueden pasar un Bearer:
 *  - A FAVOR: la sesión sobrevive a un refresco de página (si no, cada F5
 *    obligaría a volver a `/login`), que es lo que espera un usuario de una
 *    herramienta interna de RRHH.
 *  - La API es la ÚNICA fuente de permisos
 *    (guards `AuthGuard` + `RolesGuard`); en el cliente solo se decide qué
 *    botones se muestran, nunca qué operaciones se permiten. Si el token se
 *    filtra, caduca por `JWT_TTL_HOURS` y el 401 lo descarta.
 */

/** Clave de estado visual; nunca debe contener un JWT en producción. */
export const CLAVE_SESION = 'ats.sesion.v2';

/** Estado visual guardado; `token` solo es el marcador `cookie` en producción. */
interface SesionGuardada {
  token: string;
  usuario: UsuarioSesion;
}

/**
 * Lee y valida la sesión persistida.
 *
 * Toda lectura va envuelta en `try/catch`: `localStorage` puede no existir
 * (entornos sin DOM) o estar lleno/bloqueado, y un fallo de arranque no debe
 * tumbar la app — se queda en `/login`.
 */
function leerSesion(): SesionGuardada | null {
  try {
    const bruto = localStorage.getItem(CLAVE_SESION);
    if (bruto === null) return null;
    const datos = JSON.parse(bruto) as Partial<SesionGuardada>;
    if (
      typeof datos.token !== 'string' ||
      datos.token.length === 0 ||
      typeof datos.usuario?.email !== 'string' ||
      typeof datos.usuario?.role !== 'string'
    ) {
      return null;
    }
    return { token: datos.token, usuario: datos.usuario };
  } catch {
    return null;
  }
}

function guardarSesion(sesion: SesionGuardada): void {
  try {
    localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  } catch {
    // Sin almacenamiento disponible: la sesión sigue viva en memoria.
  }
}

function borrarSesion(): void {
  try {
    localStorage.removeItem(CLAVE_SESION);
  } catch {
    // Sin almacenamiento disponible: no hay nada que borrar.
  }
}

export interface EstadoSesion {
  /** JWT de la API o `null` si no hay sesión. Se envía como `Bearer`. */
  token: string | null;
  usuario: UsuarioSesion | null;
  /** Guarda el marcador de sesión + usuario en memoria y almacenamiento local. */
  iniciarSesion: (token: string, usuario: UsuarioSesion) => void;
  /** Descarta el estado visual en memoria y almacenamiento local (idempotente). */
  cerrarSesion: () => void;
}

/** Sesión hidratada desde `localStorage` al importar el módulo (una sola vez). */
const sesionHidratada = leerSesion();

export const useSesionStore = create<EstadoSesion>()((set) => ({
  token: sesionHidratada?.token ?? null,
  usuario: sesionHidratada?.usuario ?? null,
  iniciarSesion: (token, usuario) => {
    guardarSesion({ token, usuario });
    set({ token, usuario });
  },
  cerrarSesion: () => {
    borrarSesion();
    set({ token: null, usuario: null });
  },
}));

/**
 * Acceso al estado SIN suscripción (para `lib/api.ts`, que no es un componente
 * React y no puede usar el hook `useSesionStore`).
 */
export function estadoSesion(): Pick<EstadoSesion, 'token' | 'usuario'> {
  return useSesionStore.getState();
}
