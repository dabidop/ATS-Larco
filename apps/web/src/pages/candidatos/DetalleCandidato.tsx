import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { descargar, mensajeDeError, solicitud, subirArchivo } from '../../lib/api';
import { validarArchivoCv } from '../../lib/archivos';
import { fechaCorta, fechaHora, tamanoArchivo, valorHistorial } from '../../lib/formato';
import {
  puedeEditarCandidato,
  puedeEliminarCandidato,
  puedeGestionarCandidatos,
} from '../../lib/rbac';
import { useRecurso } from '../../lib/useRecurso';
import { useSesionStore } from '../../store/sesion';
import type { ArchivoCv, Candidato, CandidatoNuevo, EntradaHistorial } from '../../tipos';
import { FormularioCandidato } from '../../components/candidatos/FormularioCandidato';
import { FilaDato, Tarjeta } from '../../components/ui/datos';
import { AvisoExito, EstadoVacio, MensajeError, Spinner } from '../../components/ui/feedback';
import { CLASE_BOTON_PELIGRO, CLASE_BOTON_SECUNDARIO } from '../../components/ui/estilos';

/**
 * Detalle del candidato: datos (la API devuelve cédula y teléfono DESCIFRADOS
 * al cliente autenticado), edición, archivos de CV e historial de auditoría.
 *
 * El historial llega con la PII YA ENMASCARADA (`***`) desde el backend: aquí
 * se muestra tal cual, sin intentar descifrar nada.
 */
export function PaginaDetalleCandidato() {
  const parametros = useParams();
  const id = parametros.id ?? '';
  const navegar = useNavigate();
  const [recarga, setRecarga] = useState(0);
  const [editando, setEditando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [exito, setExito] = useState<string | null>(null);
  const [errorOperacion, setErrorOperacion] = useState<string | null>(null);

  const usuario = useSesionStore((sesion) => sesion.usuario);

  const recurso = useRecurso<Candidato>(
    () => solicitud<Candidato>(`/candidatos/${id}`),
    [id, recarga],
  );
  const candidato = recurso.datos;

  const recargarTodo = () => {
    setEditando(false);
    setRecarga((anterior) => anterior + 1);
  };

  const alEditar = async (cuerpo: CandidatoNuevo) => {
    await solicitud<Candidato>(`/candidatos/${id}`, { metodo: 'PATCH', cuerpo });
    setExito('Cambios guardados correctamente');
    recargarTodo();
  };

  /**
   * Borrado de un candidato capturado por ERROR (corrección posterior a la
   * Etapa 9): solo IT o quien lo creó, y solo si NO está ligado a un
   * requerimiento. El `confirm` es la única barrera suave; el servidor manda
   * (403/409) y su mensaje se pinta tal cual.
   */
  const alEliminar = async (nombre: string) => {
    const confirmado = window.confirm(
      `¿Eliminar definitivamente a ${nombre}? Esta acción no se puede deshacer.`,
    );
    if (!confirmado) return;

    setEliminando(true);
    setErrorOperacion(null);
    try {
      await solicitud<void>(`/candidatos/${id}`, { metodo: 'DELETE' });
      navegar('/candidatos');
    } catch (error) {
      setErrorOperacion(mensajeDeError(error, 'No se pudo eliminar el candidato'));
    } finally {
      setEliminando(false);
    }
  };

  if (recurso.fase === 'cargando' && candidato === null) {
    return <Spinner texto="Cargando candidato…" />;
  }
  if (recurso.fase === 'error' || candidato === null) {
    return (
      <MensajeError
        mensaje={recurso.error ?? 'No se pudo cargar el candidato'}
        onReintentar={recurso.recargar}
      />
    );
  }

  const esCreador = usuario !== null && candidato.createdBy === usuario.id;
  const rol = usuario?.role ?? null;
  const faltanDatosLaborales =
    candidato.cargoActual === null || candidato.expectativaSalarial === null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            {candidato.nombres} {candidato.apellidos}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Cédula {candidato.cedula} · Creado el {fechaCorta(candidato.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {puedeEditarCandidato(rol, esCreador) && !editando && (
            <button
              type="button"
              onClick={() => {
                setExito(null);
                setErrorOperacion(null);
                setEditando(true);
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              {faltanDatosLaborales ? 'Completar datos' : 'Editar'}
            </button>
          )}
          <Link to="/candidatos" className={CLASE_BOTON_SECUNDARIO}>
            ← Volver
          </Link>
          {puedeEliminarCandidato(rol, esCreador) && !editando && (
            <button
              type="button"
              onClick={() => {
                void alEliminar(`${candidato.nombres} ${candidato.apellidos}`.trim());
              }}
              disabled={eliminando}
              className={CLASE_BOTON_PELIGRO}
            >
              {eliminando ? 'Eliminando…' : 'Eliminar candidato'}
            </button>
          )}
        </div>
      </div>

      {exito && <AvisoExito mensaje={exito} />}
      {errorOperacion && <MensajeError mensaje={errorOperacion} />}

      {editando ? (
        <FormularioCandidato
          inicial={candidato}
          textoGuardar="Guardar cambios"
          onGuardar={alEditar}
        />
      ) : (
        <>
          {faltanDatosLaborales && puedeEditarCandidato(rol, esCreador) && (
            <div className="mb-4 rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
              Esta hoja de vida no contiene toda la información laboral. Puedes completar
              manualmente el cargo actual y la expectativa salarial.
            </div>
          )}
          <Tarjeta titulo="Datos del candidato">
            <dl className="grid gap-4 sm:grid-cols-3">
              <FilaDato etiqueta="Cédula" valor={candidato.cedula} />
              <FilaDato etiqueta="Teléfono" valor={candidato.telefono ?? '—'} />
              <FilaDato etiqueta="Email" valor={candidato.email ?? '—'} />
              <FilaDato etiqueta="Ciudad" valor={candidato.ciudad ?? '—'} />
              <FilaDato etiqueta="Cargo actual" valor={candidato.cargoActual ?? '—'} />
              <FilaDato
                etiqueta="Expectativa salarial"
                valor={
                  candidato.expectativaSalarial === null
                    ? '—'
                    : String(candidato.expectativaSalarial)
                }
              />
              <FilaDato etiqueta="Disponibilidad" valor={candidato.disponibilidad ?? '—'} />
              <FilaDato etiqueta="Última actualización" valor={fechaHora(candidato.updatedAt)} />
              <FilaDato etiqueta="Notas" valor={candidato.notas ?? '—'} />
            </dl>
          </Tarjeta>
        </>
      )}

      <SeccionArchivos candidatoId={id} rol={rol} />
      <SeccionHistorial candidatoId={id} />
    </div>
  );
}

/**
 * Sección de archivos de CV: subida (solo `analista_seleccion`/`admin_rrhh`/
 * `superusuario`, con validación de tipo y tamaño ANTES de enviar) y descarga
 * (fetch→blob→objectURL, porque el endpoint exige el header `Authorization`).
 */
function SeccionArchivos({ candidatoId, rol }: { candidatoId: string; rol: string | null }) {
  const archivos = useRecurso<ArchivoCv[]>(
    () => solicitud<ArchivoCv[]>(`/candidatos/${candidatoId}/archivos`),
    [candidatoId],
  );
  const [subiendo, setSubiendo] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const puedeSubir = puedeGestionarCandidatos(rol);

  const alSeleccionar = async (evento: ChangeEvent<HTMLInputElement>) => {
    const archivo = evento.target.files?.[0];
    if (archivo === undefined) return;

    setErrorSubida(null);
    setExito(null);
    const problema = validarArchivoCv(archivo);
    if (problema !== null) {
      // Validación de cliente: ni siquiera se envía la petición.
      setErrorSubida(problema);
      evento.target.value = '';
      return;
    }

    setSubiendo(true);
    try {
      await subirArchivo<ArchivoCv>(`/candidatos/${candidatoId}/archivos`, archivo);
      setExito(`CV adjuntado: ${archivo.name}`);
      archivos.recargar();
    } catch (capturado) {
      setErrorSubida(mensajeDeError(capturado, 'No se pudo subir el archivo'));
    } finally {
      setSubiendo(false);
      evento.target.value = '';
      if (inputArchivo.current !== null) inputArchivo.current.value = '';
    }
  };

  const alDescargar = async (archivo: ArchivoCv) => {
    setErrorDescarga(null);
    try {
      await descargar(
        `/candidatos/${candidatoId}/archivos/${archivo.id}/descarga`,
        archivo.filenameOriginal,
      );
    } catch (capturado) {
      setErrorDescarga(mensajeDeError(capturado, 'No se pudo descargar el archivo'));
    }
  };

  return (
    <Tarjeta titulo="Archivos (CV)">
      {puedeSubir ? (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="archivo-cv"
              className="text-xs font-semibold uppercase tracking-wide text-slate-400"
            >
              Adjuntar CV (PDF, DOC, DOCX o RTF · máx. 5 MB)
            </label>
            <input
              ref={inputArchivo}
              id="archivo-cv"
              type="file"
              accept=".pdf,.doc,.docx,.rtf"
              onChange={(evento) => void alSeleccionar(evento)}
              className="mt-1 block w-full max-w-sm text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-100 hover:file:bg-slate-600"
            />
          </div>
          {subiendo && <Spinner texto="Subiendo archivo…" />}
        </div>
      ) : (
        <p className="mb-4 rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
          Tu rol puede consultar los archivos, pero no adjuntar nuevos CVs.
        </p>
      )}

      {exito && <AvisoExito mensaje={exito} />}
      {errorSubida && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-rose-700/60 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
        >
          {errorSubida}
        </p>
      )}
      {errorDescarga && <MensajeError mensaje={errorDescarga} />}

      {archivos.fase === 'cargando' && archivos.datos === null && (
        <Spinner texto="Cargando archivos…" />
      )}
      {archivos.fase === 'error' && (
        <MensajeError
          mensaje={archivos.error ?? 'No se pudieron cargar los archivos'}
          onReintentar={archivos.recargar}
        />
      )}
      {archivos.fase === 'listo' && archivos.datos !== null && archivos.datos.length === 0 && (
        <EstadoVacio mensaje="Sin archivos adjuntos todavía." />
      )}
      {archivos.fase === 'listo' && archivos.datos !== null && archivos.datos.length > 0 && (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {archivos.datos.map((archivo) => (
            <li
              key={archivo.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-slate-100">{archivo.filenameOriginal}</p>
                <p className="text-xs text-slate-400">
                  {tamanoArchivo(archivo.sizeBytes)} · {archivo.mimeType} ·{' '}
                  {fechaHora(archivo.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void alDescargar(archivo)}
                className={CLASE_BOTON_SECUNDARIO}
              >
                Descargar
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

/** Historial de auditoría (`GET /:id/historial`): la PII aparece como `***`. */
function SeccionHistorial({ candidatoId }: { candidatoId: string }) {
  const historial = useRecurso<EntradaHistorial[]>(
    () => solicitud<EntradaHistorial[]>(`/candidatos/${candidatoId}/historial`),
    [candidatoId],
  );

  return (
    <Tarjeta titulo="Historial de cambios">
      {historial.fase === 'cargando' && historial.datos === null && (
        <Spinner texto="Cargando historial…" />
      )}
      {historial.fase === 'error' && (
        <MensajeError
          mensaje={historial.error ?? 'No se pudo cargar el historial'}
          onReintentar={historial.recargar}
        />
      )}
      {historial.fase === 'listo' && historial.datos !== null && historial.datos.length === 0 && (
        <EstadoVacio mensaje="Sin movimientos registrados." />
      )}
      {historial.fase === 'listo' && historial.datos !== null && historial.datos.length > 0 && (
        <ol className="space-y-3">
          {historial.datos.map((entrada) => (
            <li key={entrada.id} className="rounded-lg border border-slate-800 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-200">
                  {entrada.accion === 'INSERT'
                    ? 'Alta'
                    : entrada.accion === 'UPDATE'
                      ? 'Modificación'
                      : 'Borrado'}
                </span>
                <span className="text-xs text-slate-400">{fechaHora(entrada.fecha)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {entrada.usuarioEmail ?? 'usuario desconocido'}
              </p>
              {entrada.campos.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  Sin campos que mostrar (registro inicial).
                </p>
              ) : (
                <dl className="mt-2 space-y-1">
                  {entrada.campos.map((cambio) => (
                    <div key={cambio.campo} className="flex flex-wrap gap-2 text-xs">
                      <dt className="font-medium text-slate-300">{cambio.campo}</dt>
                      <dd className="text-slate-400">
                        {valorHistorial(cambio.antes)} → {valorHistorial(cambio.despues)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ol>
      )}
    </Tarjeta>
  );
}
