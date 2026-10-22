import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { mensajeDeError, solicitud } from '../../lib/api';
import { fechaCorta } from '../../lib/formato';
import { ROLES_MATRIZ, etiquetaRol, puedeGestionarUsuarios } from '../../lib/rbac';
import { useRecurso } from '../../lib/useRecurso';
import { useSesionStore } from '../../store/sesion';
import type { Pagina, Usuario, UsuarioActualizacion } from '../../tipos';
import { Paginacion } from '../../components/ui/datos';
import { AvisoExito, EstadoVacio, MensajeError, Spinner } from '../../components/ui/feedback';
import {
  CLASE_BOTON_PRINCIPAL,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CAMPO,
  CLASE_ETIQUETA,
} from '../../components/ui/estilos';
import { MENSAJE_PASSWORD_CORTA, PASSWORD_MINIMA } from './NuevoUsuario';

/** Tamaño de página del listado: el `DEFAULT_LIMIT` de la API es 20. */
const LIMITE = 20;

/**
 * Listado paginado de usuarios (`GET /api/usuarios?page&limit&q&rol`),
 * EXCLUSIVO del `superusuario` (IT): la ruta está protegida por rol y la API
 * devuelve 403 al resto (incluido `admin_rrhh`).
 *
 * Acciones por fila, todas vía `PATCH /api/usuarios/:id`:
 *  - Cambiar rol (select + Guardar).
 *  - Activar / Desactivar (baja lógica).
 *  - Restablecer contraseña (mínimo 8 caracteres).
 *
 * Autoprotección UX: en la fila del usuario LOGUEADO el cambio de rol y la
 * desactivación están deshabilitados — el servidor los bloquea además con 409
 * («No puede desactivar su propia cuenta» / «No puede cambiar su propio rol»).
 * Los errores 400/409 del backend se muestran tal cual con `MensajeError`.
 */
export function PaginaUsuarios() {
  const rol = useSesionStore((sesion) => sesion.usuario?.role ?? null);
  const miId = useSesionStore((sesion) => sesion.usuario?.id ?? null);
  const ubicacion = useLocation();
  // Aviso que trae `NuevoUsuario` tras crear una cuenta (`location.state.exito`).
  const avisoDeEntrada = (ubicacion.state as { exito?: string } | null)?.exito ?? null;

  const [pagina, setPagina] = useState(1);
  const [valores, setValores] = useState({ q: '', rol: '' });
  const [consulta, setConsulta] = useState({ q: '', rol: '' });
  const [exito, setExito] = useState<string | null>(avisoDeEntrada);
  const [error, setError] = useState<string | null>(null);
  const [rolElegido, setRolElegido] = useState<Record<string, string>>({});
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const recurso = useRecurso<Pagina<Usuario>>(async () => {
    // Fuera del rol ni siquiera se pide la lista: la API respondería 403.
    if (!puedeGestionarUsuarios(rol)) return { items: [], total: 0, page: 1, limit: LIMITE };
    const parametros = new URLSearchParams({ page: String(pagina), limit: String(LIMITE) });
    if (consulta.q.length > 0) parametros.set('q', consulta.q);
    if (consulta.rol.length > 0) parametros.set('rol', consulta.rol);
    return solicitud<Pagina<Usuario>>(`/usuarios?${parametros.toString()}`);
  }, [pagina, consulta, rol]);

  const alBuscar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setConsulta({ ...valores, q: valores.q.trim() });
    setPagina(1);
  };

  const alCambiarFiltroRol = (nuevoRol: string) => {
    setValores((anterior) => ({ ...anterior, rol: nuevoRol }));
    setConsulta((anterior) => ({ ...anterior, rol: nuevoRol }));
    setPagina(1);
  };

  /** PATCH genérico de fila: aviso de éxito, recarga y errores 400/409 visibles. */
  const aplicarCambio = async (
    usuario: Usuario,
    cuerpo: UsuarioActualizacion,
    mensajeExito: string,
  ) => {
    setExito(null);
    setError(null);
    setOcupado(usuario.id);
    try {
      await solicitud<Usuario>(`/usuarios/${usuario.id}`, { metodo: 'PATCH', cuerpo });
      setExito(mensajeExito);
      setRolElegido((anterior) => {
        const copia = { ...anterior };
        delete copia[usuario.id];
        return copia;
      });
      setPasswords((anterior) => {
        const copia = { ...anterior };
        delete copia[usuario.id];
        return copia;
      });
      recurso.recargar();
    } catch (capturado) {
      setError(mensajeDeError(capturado, 'No se pudo guardar el cambio'));
    } finally {
      setOcupado(null);
    }
  };

  const alGuardarRol = (usuario: Usuario) => {
    const elegido = rolElegido[usuario.id] ?? usuario.rol;
    if (elegido === usuario.rol) return;
    void aplicarCambio(usuario, { rol: elegido }, `Rol de ${usuario.nombre} actualizado`);
  };

  const alAlternarActivo = (usuario: Usuario) => {
    void aplicarCambio(
      usuario,
      { activo: !usuario.activo },
      usuario.activo ? `${usuario.nombre} quedó desactivado` : `${usuario.nombre} quedó activado`,
    );
  };

  const alRestablecerPassword = (usuario: Usuario) => {
    const password = passwords[usuario.id] ?? '';
    if (password.length < PASSWORD_MINIMA) {
      setExito(null);
      setError(MENSAJE_PASSWORD_CORTA);
      return;
    }
    void aplicarCambio(usuario, { password }, `Contraseña de ${usuario.nombre} restablecida`);
  };

  const datos = recurso.datos;

  // Guardia en profundidad: la ruta ya redirige y la API responde 403.
  if (!puedeGestionarUsuarios(rol)) {
    return (
      <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-6 text-sm text-amber-200">
        Tu rol no puede gestionar usuarios: la sección de cuentas es exclusiva del superusuario
        (IT).
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Usuarios</h1>
        <Link to="/usuarios/nuevo" className={CLASE_BOTON_PRINCIPAL}>
          Nuevo usuario
        </Link>
      </div>

      <form onSubmit={alBuscar} className="mb-4 flex flex-wrap items-end gap-3" noValidate>
        <div className="w-full max-w-xs">
          <label htmlFor="filtro-q" className={CLASE_ETIQUETA}>
            Buscar por nombre o correo
          </label>
          <input
            id="filtro-q"
            className={CLASE_CAMPO}
            value={valores.q}
            placeholder="ana@larco.test"
            onChange={(evento) =>
              setValores((anterior) => ({ ...anterior, q: evento.target.value }))
            }
          />
        </div>
        <div className="w-full max-w-[180px]">
          <label htmlFor="filtro-rol" className={CLASE_ETIQUETA}>
            Filtrar por rol
          </label>
          <select
            id="filtro-rol"
            className={CLASE_CAMPO}
            value={valores.rol}
            onChange={(evento) => alCambiarFiltroRol(evento.target.value)}
          >
            <option value="">Todos los roles</option>
            {ROLES_MATRIZ.map((codigo) => (
              <option key={codigo} value={codigo}>
                {etiquetaRol(codigo)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={CLASE_BOTON_SECUNDARIO}>
          Buscar
        </button>
      </form>

      {exito && (
        <div className="mb-4">
          <AvisoExito mensaje={exito} />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <MensajeError mensaje={error} />
        </div>
      )}

      {recurso.fase === 'cargando' && datos === null && <Spinner texto="Cargando usuarios…" />}
      {recurso.fase === 'error' && (
        <MensajeError
          mensaje={recurso.error ?? 'No se pudieron cargar los usuarios'}
          onReintentar={recurso.recargar}
        />
      )}
      {recurso.fase === 'listo' && datos !== null && datos.items.length === 0 && (
        <EstadoVacio mensaje="Sin resultados: no hay usuarios que cumplan el filtro." />
      )}

      {recurso.fase === 'listo' && datos !== null && datos.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Nombre
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Correo
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Rol
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Estado
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Creado
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {datos.items.map((usuario) => {
                  const esPropio = usuario.id === miId;
                  const elegido = rolElegido[usuario.id] ?? usuario.rol;
                  const password = passwords[usuario.id] ?? '';
                  const enCurso = ocupado === usuario.id;
                  return (
                    <tr key={usuario.id} className="align-top hover:bg-slate-900/60">
                      <td className="px-4 py-3 font-medium text-slate-100">{usuario.nombre}</td>
                      <td className="px-4 py-3 text-slate-300">{usuario.email}</td>
                      <td className="px-4 py-3 text-slate-300">{usuario.rolNombre}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            usuario.activo
                              ? 'inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300'
                              : 'inline-flex rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-300'
                          }
                        >
                          {usuario.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{fechaCorta(usuario.creadoEn)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`Nuevo rol de ${usuario.nombre}`}
                            className={CLASE_CAMPO}
                            value={elegido}
                            disabled={esPropio || enCurso}
                            onChange={(evento) =>
                              setRolElegido((anterior) => ({
                                ...anterior,
                                [usuario.id]: evento.target.value,
                              }))
                            }
                          >
                            {ROLES_MATRIZ.map((codigo) => (
                              <option key={codigo} value={codigo}>
                                {/* El rol ACTUAL muestra el nombre que viene de BD
                                    (rolNombre) para no contradecir la celda. */}
                                {codigo === usuario.rol ? usuario.rolNombre : etiquetaRol(codigo)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            aria-label={`Guardar rol de ${usuario.nombre}`}
                            className={CLASE_BOTON_SECUNDARIO}
                            disabled={esPropio || enCurso || elegido === usuario.rol}
                            onClick={() => alGuardarRol(usuario)}
                          >
                            Guardar rol
                          </button>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            aria-label={`${
                              usuario.activo ? 'Desactivar' : 'Activar'
                            } a ${usuario.nombre}`}
                            className={
                              usuario.activo ? CLASE_BOTON_SECUNDARIO : CLASE_BOTON_PRINCIPAL
                            }
                            disabled={enCurso || (esPropio && usuario.activo)}
                            onClick={() => alAlternarActivo(usuario)}
                          >
                            {usuario.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          {esPropio && (
                            <span className="text-xs text-slate-500">Eres tú (autoprotección)</span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            type="password"
                            aria-label={`Nueva contraseña de ${usuario.nombre}`}
                            autoComplete="new-password"
                            placeholder={`Mínimo ${PASSWORD_MINIMA} caracteres`}
                            className={CLASE_CAMPO}
                            value={password}
                            disabled={enCurso}
                            onChange={(evento) =>
                              setPasswords((anterior) => ({
                                ...anterior,
                                [usuario.id]: evento.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            aria-label={`Restablecer contraseña de ${usuario.nombre}`}
                            className={CLASE_BOTON_SECUNDARIO}
                            disabled={enCurso}
                            onClick={() => alRestablecerPassword(usuario)}
                          >
                            Restablecer contraseña
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Paginacion
            pagina={datos.page}
            total={datos.total}
            limit={datos.limit}
            onCambio={setPagina}
          />
        </>
      )}
    </div>
  );
}
