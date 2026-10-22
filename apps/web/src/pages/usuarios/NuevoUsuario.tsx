import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { mensajeDeError, solicitud } from '../../lib/api';
import { ROLES_MATRIZ, etiquetaRol, puedeGestionarUsuarios } from '../../lib/rbac';
import { useSesionStore } from '../../store/sesion';
import type { Usuario, UsuarioNuevo } from '../../tipos';
import { CampoTexto } from '../../components/ui/campos';
import { Spinner } from '../../components/ui/feedback';
import {
  CLASE_BOTON_PRINCIPAL,
  CLASE_CAMPO,
  CLASE_CAMPO_CON_ERROR,
  CLASE_ETIQUETA,
} from '../../components/ui/estilos';

/** Longitud mínima de contraseña que exige `CreateUsuarioDto` (`@MinLength(8)`). */
export const PASSWORD_MINIMA = 8;

/** Mensaje del DTO del backend, reutilizado por el listado (reset de contraseña). */
export const MENSAJE_PASSWORD_CORTA = `password debe tener al menos ${PASSWORD_MINIMA} caracteres`;

const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CampoFormulario = 'nombre' | 'email' | 'password' | 'rol';
type ErroresUsuario = Partial<Record<CampoFormulario, string>>;

/** Valida el alta con los MISMOS mensajes en español que el DTO del backend. */
export function validarAltaUsuario(formulario: {
  nombre: string;
  email: string;
  password: string;
  rol: string;
}): ErroresUsuario {
  const errores: ErroresUsuario = {};
  if (formulario.nombre.trim().length === 0) errores.nombre = 'nombre es obligatorio';
  if (!PATRON_EMAIL.test(formulario.email.trim())) {
    errores.email = 'email debe ser un correo electrónico válido';
  }
  if (formulario.password.length < PASSWORD_MINIMA) errores.password = MENSAJE_PASSWORD_CORTA;
  if (formulario.rol.length === 0) errores.rol = 'rol es obligatorio';
  return errores;
}

/**
 * Alta de usuarios (`POST /api/usuarios`) — EXCLUSIVA del `superusuario`.
 *
 * Misma estructura que `NuevoRequerimiento`/`NuevoCandidato`: guardia de rol,
 * vuelta visible «← Volver» junto al título y errores del servidor (409
 * «Ya existe un usuario con ese correo», 400 de validación) en un alerta.
 * Tras crear, vuelve al listado con un aviso de éxito en `location.state`.
 */
export function PaginaNuevoUsuario() {
  const navegar = useNavigate();
  const rol = useSesionStore((sesion) => sesion.usuario?.role ?? null);

  const [formulario, setFormulario] = useState({
    nombre: '',
    email: '',
    password: '',
    rol: '',
  });
  const [errores, setErrores] = useState<ErroresUsuario>({});
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = (campo: CampoFormulario) => (valor: string) => {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }));
    setErrores((anteriores) => ({ ...anteriores, [campo]: undefined }));
  };

  const alEnviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const detectados = validarAltaUsuario(formulario);
    setErrores(detectados);
    if (Object.values(detectados).some((error) => error !== undefined)) return;

    const cuerpo: UsuarioNuevo = {
      nombre: formulario.nombre.trim(),
      email: formulario.email.trim(),
      password: formulario.password,
      rol: formulario.rol,
    };

    setEnviando(true);
    setErrorServidor(null);
    try {
      const creado = await solicitud<Usuario>('/usuarios', { metodo: 'POST', cuerpo });
      navegar('/usuarios', { state: { exito: `Usuario «${creado.nombre}» creado correctamente` } });
    } catch (capturado) {
      setErrorServidor(mensajeDeError(capturado, 'No se pudo crear el usuario'));
    } finally {
      setEnviando(false);
    }
  };

  // Guardia en profundidad: la ruta ya redirige al resto de roles y la API
  // respondería 403, pero el formulario ni siquiera se pinta.
  if (!puedeGestionarUsuarios(rol)) {
    return (
      <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-6 text-sm text-amber-200">
        Tu rol no puede gestionar usuarios: el alta de cuentas es exclusiva del superusuario (IT).
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          to="/usuarios"
          className="text-sm font-semibold text-emerald-400 hover:text-emerald-300"
        >
          ← Volver
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Nuevo usuario</h1>
      </div>

      <form onSubmit={alEnviar} className="max-w-2xl space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            etiqueta="Nombre completo *"
            autoComplete="name"
            valor={formulario.nombre}
            onCambio={cambiar('nombre')}
            error={errores.nombre}
          />
          <CampoTexto
            etiqueta="Correo electrónico *"
            type="email"
            autoComplete="email"
            valor={formulario.email}
            onCambio={cambiar('email')}
            error={errores.email}
          />
          <CampoTexto
            etiqueta={`Contraseña * (mínimo ${PASSWORD_MINIMA} caracteres)`}
            type="password"
            autoComplete="new-password"
            valor={formulario.password}
            onCambio={cambiar('password')}
            error={errores.password}
          />
          <div>
            <label htmlFor="alta-rol" className={CLASE_ETIQUETA}>
              Rol *
            </label>
            <select
              id="alta-rol"
              className={errores.rol === undefined ? CLASE_CAMPO : CLASE_CAMPO_CON_ERROR}
              value={formulario.rol}
              onChange={(evento) => cambiar('rol')(evento.target.value)}
            >
              <option value="">Selecciona un rol</option>
              {ROLES_MATRIZ.map((codigo) => (
                <option key={codigo} value={codigo}>
                  {etiquetaRol(codigo)}
                </option>
              ))}
            </select>
            {errores.rol && <p className="mt-1 text-xs text-rose-400">{errores.rol}</p>}
          </div>
        </div>

        {errorServidor && (
          <p
            role="alert"
            className="rounded-lg border border-rose-700/60 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
          >
            {errorServidor}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={enviando} className={CLASE_BOTON_PRINCIPAL}>
            {enviando ? 'Creando…' : 'Crear usuario'}
          </button>
          {enviando && <Spinner texto="Creando usuario…" />}
        </div>
      </form>
    </div>
  );
}
