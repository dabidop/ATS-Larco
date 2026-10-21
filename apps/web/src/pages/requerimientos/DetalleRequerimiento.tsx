import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { mensajeDeError, solicitud } from '../../lib/api';
import {
  ETIQUETA_ESTADO,
  ETIQUETA_TRANSICION,
  requiereMotivo,
  transicionesPermitidas,
} from '../../lib/flujo';
import { fechaCorta, fechaHora, listaATexto, dinero } from '../../lib/formato';
import { puedeEditarRequerimiento } from '../../lib/rbac';
import { useRecurso } from '../../lib/useRecurso';
import { useSesionStore } from '../../store/sesion';
import type { DestinoTransicion, Requerimiento, RequerimientoNuevo } from '../../tipos';
import { FormularioRequerimiento } from '../../components/requerimientos/FormularioRequerimiento';
import { BadgeEstado, FilaDato, Tarjeta } from '../../components/ui/datos';
import { AvisoExito, EstadoVacio, MensajeError, Spinner } from '../../components/ui/feedback';
import {
  CLASE_BOTON_PELIGRO,
  CLASE_BOTON_PRINCIPAL,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CAMPO,
  CLASE_ETIQUETA,
} from '../../components/ui/estilos';

/**
 * Detalle del requerimiento: las 5 secciones en tarjetas, badge de estado,
 * transiciones disponibles y edición (solo en `pendiente`).
 *
 * Las transiciones disponibles se calculan en `lib/flujo.ts`, que replica la
 * matriz del backend (`requerimientos-flujo.ts`): la API no expone un GET de
 * transiciones. La autoridad sigue en el servidor (409/403).
 */
export function PaginaDetalleRequerimiento() {
  const parametros = useParams();
  const id = parametros.id ?? '';
  const [recarga, setRecarga] = useState(0);
  const [editando, setEditando] = useState(false);
  const [transicionando, setTransicionando] = useState(false);
  const [errorOperacion, setErrorOperacion] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [mostrarMotivo, setMostrarMotivo] = useState(false);
  const [motivo, setMotivo] = useState('');

  const usuario = useSesionStore((sesion) => sesion.usuario);

  const recurso = useRecurso<Requerimiento>(
    () => solicitud<Requerimiento>(`/requerimientos/${id}`),
    [id, recarga],
  );
  const requerimiento = recurso.datos;

  const recargar = () => {
    setEditando(false);
    setRecarga((anterior) => anterior + 1);
  };

  const transicionar = async (destino: DestinoTransicion, motivoRechazo?: string) => {
    setTransicionando(true);
    setErrorOperacion(null);
    setExito(null);
    try {
      const cuerpo = motivoRechazo === undefined ? { destino } : { destino, motivo: motivoRechazo };
      const actualizado = await solicitud<Requerimiento>(`/requerimientos/${id}/transiciones`, {
        metodo: 'POST',
        cuerpo,
      });
      setExito(`Requerimiento ${actualizado.code}: ${ETIQUETA_ESTADO[actualizado.estado]}`);
      setMostrarMotivo(false);
      setMotivo('');
      recargar();
    } catch (capturado) {
      setErrorOperacion(mensajeDeError(capturado, 'No se pudo completar la transición'));
    } finally {
      setTransicionando(false);
    }
  };

  const alEditar = async (cuerpo: RequerimientoNuevo) => {
    await solicitud<Requerimiento>(`/requerimientos/${id}`, { metodo: 'PATCH', cuerpo });
    setExito('Cambios guardados correctamente');
    recargar();
  };

  if (recurso.fase === 'cargando' && requerimiento === null) {
    return <Spinner texto="Cargando requerimiento…" />;
  }
  if (recurso.fase === 'error' || requerimiento === null) {
    return (
      <MensajeError
        mensaje={recurso.error ?? 'No se pudo cargar el requerimiento'}
        onReintentar={recurso.recargar}
      />
    );
  }

  const esCreador = usuario !== null && requerimiento.createdBy === usuario.id;
  const rol = usuario?.role ?? null;
  const opciones = transicionesPermitidas(requerimiento.estado, rol, esCreador);
  const editable = requerimiento.estado === 'pendiente' && puedeEditarRequerimiento(rol, esCreador);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{requerimiento.code}</p>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            {requerimiento.titulo}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Creado el {fechaCorta(requerimiento.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BadgeEstado estado={requerimiento.estado} />
          {requerimiento.estado === 'en_proceso' ? (
            <Link to={`/requerimientos/${id}/embudo`} className={CLASE_BOTON_SECUNDARIO}>
              Tablero de selección
            </Link>
          ) : (
            <p className="max-w-56 text-xs text-slate-500">
              El tablero de selección se usa cuando el requerimiento está «En proceso».
            </p>
          )}
          {editable && !editando && (
            <button
              type="button"
              onClick={() => {
                setExito(null);
                setErrorOperacion(null);
                setEditando(true);
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Editar
            </button>
          )}
          <Link to="/requerimientos" className={CLASE_BOTON_SECUNDARIO}>
            Volver
          </Link>
        </div>
      </div>

      {requerimiento.motivoRechazo && (
        <div className="rounded-lg border border-rose-700/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          <span className={CLASE_ETIQUETA}>Motivo del rechazo</span>
          <p className="mt-1">{requerimiento.motivoRechazo}</p>
        </div>
      )}

      {exito && <AvisoExito mensaje={exito} />}
      {errorOperacion && <MensajeError mensaje={errorOperacion} />}

      {opciones.length > 0 && !editando && (
        <Tarjeta titulo="Acciones de estado">
          <div className="flex flex-wrap gap-3">
            {opciones.map((destino) => (
              <button
                key={destino}
                type="button"
                disabled={transicionando}
                onClick={() => {
                  if (requiereMotivo(destino)) {
                    setMostrarMotivo(true);
                  } else {
                    void transicionar(destino);
                  }
                }}
                className={requiereMotivo(destino) ? CLASE_BOTON_PELIGRO : CLASE_BOTON_PRINCIPAL}
              >
                {ETIQUETA_TRANSICION[destino]}
              </button>
            ))}
          </div>

          {mostrarMotivo && (
            <div className="mt-4 rounded-lg border border-rose-700/60 bg-rose-950/40 p-4">
              <label htmlFor="motivo-rechazo" className={CLASE_ETIQUETA}>
                Motivo del rechazo (obligatorio)
              </label>
              <textarea
                id="motivo-rechazo"
                rows={3}
                className={CLASE_CAMPO}
                value={motivo}
                onChange={(evento) => setMotivo(evento.target.value)}
              />
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={motivo.trim().length === 0 || transicionando}
                  onClick={() => void transicionar('rechazado', motivo.trim())}
                  className={CLASE_BOTON_PELIGRO}
                >
                  Confirmar rechazo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMostrarMotivo(false);
                    setMotivo('');
                  }}
                  className={CLASE_BOTON_SECUNDARIO}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </Tarjeta>
      )}

      {editando ? (
        <FormularioRequerimiento
          inicial={requerimiento}
          textoGuardar="Guardar cambios"
          onGuardar={alEditar}
        />
      ) : (
        <>
          <Tarjeta titulo="1. Identificación y jefatura">
            <dl className="grid gap-4 sm:grid-cols-2">
              <FilaDato etiqueta="Título" valor={requerimiento.titulo} />
              <FilaDato etiqueta="Jefatura" valor={requerimiento.jefatura} />
              <FilaDato etiqueta="Número de plazas" valor={String(requerimiento.numeroPlazas)} />
              <FilaDato etiqueta="Ubicación" valor={requerimiento.ubicacion ?? '—'} />
              <FilaDato
                etiqueta="Fecha requerida"
                valor={fechaCorta(requerimiento.fechaRequerida)}
              />
              <FilaDato
                etiqueta="Última actualización"
                valor={fechaHora(requerimiento.updatedAt)}
              />
            </dl>
          </Tarjeta>

          <Tarjeta titulo="2. Perfil profesional">
            <dl className="grid gap-4 sm:grid-cols-2">
              <FilaDato
                etiqueta="Experiencia requerida"
                valor={requerimiento.experienciaRequerida ?? '—'}
              />
              <FilaDato etiqueta="Nivel de educación" valor={requerimiento.nivelEducacion ?? '—'} />
              <div className="sm:col-span-2">
                <FilaDato etiqueta="Perfil profesional" valor={requerimiento.perfilProfesional} />
              </div>
            </dl>
          </Tarjeta>

          <Tarjeta titulo="3. Conocimientos y habilidades">
            {requerimiento.conocimientos.length === 0 && requerimiento.habilidades.length === 0 ? (
              <EstadoVacio mensaje="Sin conocimientos ni habilidades registrados." />
            ) : (
              <dl className="grid gap-4">
                <FilaDato
                  etiqueta="Conocimientos"
                  valor={listaATexto(requerimiento.conocimientos)}
                />
                <FilaDato etiqueta="Habilidades" valor={listaATexto(requerimiento.habilidades)} />
              </dl>
            )}
          </Tarjeta>

          <Tarjeta titulo="4. Condiciones salariales y contractuales">
            <dl className="grid gap-4 sm:grid-cols-2">
              <FilaDato
                etiqueta="Salario mínimo"
                valor={requerimiento.salarioMin === null ? '—' : dinero(requerimiento.salarioMin)}
              />
              <FilaDato
                etiqueta="Salario máximo"
                valor={requerimiento.salarioMax === null ? '—' : dinero(requerimiento.salarioMax)}
              />
              <FilaDato etiqueta="Tipo de contrato" valor={requerimiento.tipoContrato ?? '—'} />
              <FilaDato etiqueta="Jornada" valor={requerimiento.jornada ?? '—'} />
            </dl>
          </Tarjeta>

          <Tarjeta titulo="5. Justificación">
            <p className="text-sm whitespace-pre-wrap text-slate-100">
              {requerimiento.justificacion}
            </p>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
