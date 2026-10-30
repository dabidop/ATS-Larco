import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { ApiError, mensajeDeError, solicitud } from '../lib/api';
import { useSesionStore } from '../store/sesion';
import type { RespuestaLogin } from '../tipos';
import { CampoTexto } from '../components/ui/campos';
import { Spinner } from '../components/ui/feedback';
import { CLASE_BOTON_PRINCIPAL } from '../components/ui/estilos';

/** `location.state.from` que deja el guard de rutas protegidas. */
interface UbicacionConOrigen {
  from?: { pathname?: string };
}

/**
 * Pantalla de login (`POST /api/auth/login`).
 *
 * El 401 del backend significa «Credenciales inválidas» (anti
 * user-enumeration: es el único mensaje que devuelve); cualquier otro fallo
 * muestra el mensaje del servidor tal cual.
 */
export function PaginaLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = useSesionStore((estado) => estado.token);
  const iniciarSesion = useSesionStore((estado) => estado.iniciarSesion);
  const ubicacion = useLocation();
  const estado = ubicacion.state as UbicacionConOrigen | null;
  const destino = estado?.from?.pathname ?? '/requerimientos';

  // Sesión válida (recién iniciada o ya hidratada): fuera del formulario.
  if (token !== null) {
    return <Navigate to={destino} replace />;
  }

  const alEnviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await solicitud<RespuestaLogin>('/auth/login', {
        metodo: 'POST',
        cuerpo: { email, password },
      });
      iniciarSesion('cookie', respuesta.user);
      // La API fija cookies HttpOnly; el store solo mantiene el estado visual.
    } catch (capturado) {
      if (capturado instanceof ApiError && esErrorDeCredenciales(capturado)) {
        setError('Credenciales inválidas');
      } else {
        setError(mensajeDeError(capturado, 'No se pudo iniciar sesión'));
      }
      setEnviando(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">
          ATS · Gestión Humana — LARCO
        </h1>
        <p className="mt-1 text-sm text-slate-400">Inicia sesión para continuar</p>

        <form onSubmit={alEnviar} className="mt-5 space-y-4" noValidate>
          <CampoTexto
            etiqueta="Correo electrónico"
            type="email"
            autoComplete="username"
            required
            placeholder="usuario@larco.com"
            valor={email}
            onCambio={setEmail}
          />
          <CampoTexto
            etiqueta="Contraseña"
            type="password"
            autoComplete="current-password"
            required
            valor={password}
            onCambio={setPassword}
          />
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rose-700/60 bg-rose-950/50 px-3 py-2 text-sm text-rose-200"
            >
              {error}
            </p>
          )}

          <button type="submit" disabled={enviando} className={`${CLASE_BOTON_PRINCIPAL} w-full`}>
            {enviando ? 'Ingresando…' : 'Ingresar'}
          </button>

          {enviando && <Spinner texto="Verificando credenciales…" />}
        </form>
      </div>
    </main>
  );
}

/** Un 401 en el login siempre son credenciales (o una cuenta desactivada). */
function esErrorDeCredenciales(error: ApiError): boolean {
  return error.statusCode === 401;
}
