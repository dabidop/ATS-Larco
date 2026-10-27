import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { mensajeDeError, solicitud } from '../../lib/api';
import type {
  Candidato,
  Entrevista,
  EntrevistaNueva,
  Pagina,
  Postulacion,
  Requerimiento,
} from '../../tipos';
import { CampoTexto } from '../ui/campos';
import { EstadoVacio, MensajeError, Spinner } from '../ui/feedback';
import {
  CLASE_BOTON_PRINCIPAL,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CAMPO,
  CLASE_CAMPO_CON_ERROR,
  CLASE_ETIQUETA,
} from '../ui/estilos';

/**
 * Diálogo de AGENDAMIENTO de una entrevista (Etapa 9). La API agenda sobre una
 * POSTULACIÓN existente, así que el flujo es un mini-wizard de 3 pasos:
 *
 *  1. Buscar al candidato por nombre (`GET /api/candidatos?q=`).
 *  2. Elegir su postulación (`GET /api/postulaciones?candidatoId=&estado=activa`);
 *     los requerimientos se resuelven con un mapa cargado una sola vez.
 *  3. Completar fecha/hora/tipo/entrevistador y agendar (`POST /api/entrevistas`).
 *
 * La validación de forma replica los mensajes de `crear-entrevista.dto.ts`;
 * la autoridad sigue en el servidor (404/409/403).
 */

/** Tipos sugeridos en el `<datalist>` (el campo admite texto libre). */
const TIPOS_SUGERIDOS = [
  'Entrevista inicial',
  'Entrevista técnica',
  'Psicotécnica',
  'Entrevista final',
  'Referencias',
];

/** Recorta; `undefined` si quedó vacío (los opcionales no viajan vacíos). */
function opcional(valor: string): string | undefined {
  const limpio = valor.trim();
  return limpio.length === 0 ? undefined : limpio;
}

interface EstadoWizard {
  nombre: string;
  candidatos: Candidato[] | null;
  candidato: Candidato | null;
  postulaciones: Postulacion[];
  postulacionId: string;
  fecha: string;
  hora: string;
  tipo: string;
  entrevistador: string;
  notas: string;
}

function estadoInicial(): EstadoWizard {
  return {
    nombre: '',
    candidatos: null,
    candidato: null,
    postulaciones: [],
    postulacionId: '',
    fecha: '',
    hora: '',
    tipo: '',
    entrevistador: '',
    notas: '',
  };
}

export function DialogoAgendar({
  onCreada,
  onCerrar,
}: {
  /** Invocada con la entrevista creada (para recargar la agenda). */
  onCreada: (entrevista: Entrevista) => void;
  onCerrar: () => void;
}) {
  const [wizard, setWizard] = useState<EstadoWizard>(estadoInicial);
  const [buscando, setBuscando] = useState(false);
  const [cargandoPostulaciones, setCargandoPostulaciones] = useState(false);
  const [errores, setErrores] = useState<Partial<Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  /** Mapa `requerimientoId → código/título` para etiquetar las postulaciones. */
  const [porRequerimiento, setPorRequerimiento] = useState<
    Map<string, Pick<Requerimiento, 'id' | 'code' | 'titulo'>>
  >(new Map());

  useEffect(() => {
    // Best-effort: si falla, las opciones se etiquetan con el id recortado.
    void solicitud<Pagina<Requerimiento>>('/requerimientos?page=1&limit=100')
      .then((pagina) => {
        setPorRequerimiento(new Map(pagina.items.map((item) => [item.id, item])));
      })
      .catch(() => undefined);
  }, []);

  const cambiar = (campo: keyof EstadoWizard) => (valor: string) => {
    setWizard((anterior) => ({ ...anterior, [campo]: valor }));
    setErrores((anteriores) => ({ ...anteriores, [campo]: '' }));
  };

  const alBuscar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const consulta = wizard.nombre.trim();
    if (consulta.length === 0) {
      setErrores({ nombre: 'Escribe al menos un nombre para buscar' });
      return;
    }
    setBuscando(true);
    setError(null);
    try {
      const pagina = await solicitud<Pagina<Candidato>>(
        `/candidatos?q=${encodeURIComponent(consulta)}&page=1&limit=10`,
      );
      setWizard((anterior) => ({ ...anterior, candidatos: pagina.items }));
    } catch (capturado) {
      setError(mensajeDeError(capturado, 'No se pudo buscar candidatos'));
    } finally {
      setBuscando(false);
    }
  };

  const alElegirCandidato = async (candidato: Candidato) => {
    setCargandoPostulaciones(true);
    setError(null);
    try {
      const pagina = await solicitud<Pagina<Postulacion>>(
        `/postulaciones?candidatoId=${encodeURIComponent(candidato.id)}&estado=activa` +
          '&page=1&limit=20',
      );
      setWizard((anterior) => ({
        ...anterior,
        candidato,
        postulaciones: pagina.items,
        postulacionId: pagina.items[0]?.id ?? '',
      }));
    } catch (capturado) {
      setError(mensajeDeError(capturado, 'No se pudieron cargar las postulaciones'));
    } finally {
      setCargandoPostulaciones(false);
    }
  };

  const alEnviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    // Validación de forma (mismos mensajes que el DTO del servidor).
    const detectados: Record<string, string> = {};
    if (wizard.postulacionId === '') {
      detectados.postulacionId = 'Elige una postulación del candidato';
    }
    if (wizard.fecha.trim() === '') {
      detectados.fecha = 'fecha es obligatoria (formato YYYY-MM-DD)';
    }
    const tipo = wizard.tipo.trim();
    if (tipo.length < 3) detectados.tipo = 'tipo debe tener al menos 3 caracteres';
    else if (tipo.length > 120) detectados.tipo = 'tipo no puede superar 120 caracteres';
    const entrevistador = wizard.entrevistador.trim();
    if (entrevistador.length > 120) {
      detectados.entrevistador = 'entrevistador no puede superar 120 caracteres';
    }
    if (wizard.notas.trim().length > 4000) {
      detectados.notas = 'notas no puede superar 4000 caracteres';
    }
    setErrores(detectados);
    if (Object.values(detectados).some((texto) => texto.length > 0)) return;

    const cuerpo: EntrevistaNueva = {
      postulacionId: wizard.postulacionId,
      fecha: wizard.fecha,
      tipo,
    };
    const hora = opcional(wizard.hora);
    if (hora !== undefined) cuerpo.hora = hora;
    const entrevistadorLimpio = opcional(entrevistador);
    if (entrevistadorLimpio !== undefined) cuerpo.entrevistador = entrevistadorLimpio;
    const notas = opcional(wizard.notas);
    if (notas !== undefined) cuerpo.notas = notas;

    setEnviando(true);
    setError(null);
    try {
      const creada = await solicitud<Entrevista>('/entrevistas', { metodo: 'POST', cuerpo });
      onCreada(creada);
    } catch (capturado) {
      setError(mensajeDeError(capturado, 'No se pudo agendar la entrevista'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Agendar entrevista"
      className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4"
    >
      <div className="mt-10 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-100">Agendar entrevista</h2>
          <button type="button" onClick={onCerrar} className={CLASE_BOTON_SECUNDARIO}>
            Cerrar
          </button>
        </div>

        {error !== null && <MensajeError mensaje={error} />}

        {/* Paso 1 — búsqueda de candidato. */}
        <form onSubmit={alBuscar} className="space-y-3" noValidate>
          <CampoTexto
            etiqueta="Buscar candidato por nombre"
            valor={wizard.nombre}
            onCambio={cambiar('nombre')}
            error={errores.nombre}
            placeholder="Nombres o apellidos"
          />
          <button type="submit" disabled={buscando} className={CLASE_BOTON_SECUNDARIO}>
            {buscando ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        {buscando && <Spinner texto="Buscando candidatos…" />}

        {wizard.candidatos !== null && !buscando && wizard.candidatos.length === 0 && (
          <div className="mt-3">
            <EstadoVacio mensaje="Sin candidatos que coincidan con la búsqueda." />
          </div>
        )}

        {wizard.candidatos !== null && wizard.candidatos.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-800 rounded-lg border border-slate-800">
            {wizard.candidatos.map((candidato) => (
              <li key={candidato.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm text-slate-200">
                  {candidato.nombres} {candidato.apellidos}
                </span>
                <button
                  type="button"
                  disabled={cargandoPostulaciones}
                  onClick={() => void alElegirCandidato(candidato)}
                  className={CLASE_BOTON_SECUNDARIO}
                >
                  {wizard.candidato?.id === candidato.id ? 'Elegido' : 'Elegir'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {cargandoPostulaciones && <Spinner texto="Cargando postulaciones…" />}

        {/* Paso 2/3 — postulación + datos de la entrevista. */}
        {wizard.candidato !== null && !cargandoPostulaciones && (
          <form onSubmit={alEnviar} className="mt-4 space-y-4" noValidate>
            <div>
              <label htmlFor="agendar-postulacion" className={CLASE_ETIQUETA}>
                Postulación *
              </label>
              <select
                id="agendar-postulacion"
                value={wizard.postulacionId}
                onChange={(evento) => cambiar('postulacionId')(evento.target.value)}
                className={CLASE_CAMPO}
              >
                {wizard.postulaciones.length === 0 && (
                  <option value="">(sin postulaciones activas)</option>
                )}
                {wizard.postulaciones.map((postulacion) => {
                  const requerimiento = porRequerimiento.get(postulacion.requerimientoId);
                  const etiqueta =
                    requerimiento === undefined
                      ? `Requerimiento ${postulacion.requerimientoId.slice(0, 8)}`
                      : `${requerimiento.code} — ${requerimiento.titulo}`;
                  return (
                    <option key={postulacion.id} value={postulacion.id}>
                      {etiqueta}
                    </option>
                  );
                })}
              </select>
              {errores.postulacionId !== undefined && errores.postulacionId.length > 0 && (
                <p className="mt-1 text-xs text-rose-400">{errores.postulacionId}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <CampoTexto
                etiqueta="Fecha * (YYYY-MM-DD)"
                type="date"
                valor={wizard.fecha}
                onCambio={cambiar('fecha')}
                error={errores.fecha}
              />
              <CampoTexto
                etiqueta="Hora (HH:MM)"
                type="time"
                valor={wizard.hora}
                onCambio={cambiar('hora')}
                error={errores.hora}
              />
            </div>

            <div>
              <label htmlFor="agendar-tipo" className={CLASE_ETIQUETA}>
                Tipo de entrevista *
              </label>
              <input
                id="agendar-tipo"
                list="agendar-tipos"
                value={wizard.tipo}
                onChange={(evento) => cambiar('tipo')(evento.target.value)}
                placeholder="Entrevista inicial, Psicotécnica…"
                className={errores.tipo === undefined ? CLASE_CAMPO : CLASE_CAMPO_CON_ERROR}
                aria-invalid={errores.tipo ? 'true' : undefined}
              />
              <datalist id="agendar-tipos">
                {TIPOS_SUGERIDOS.map((tipo) => (
                  <option key={tipo} value={tipo} />
                ))}
              </datalist>
              {errores.tipo !== undefined && errores.tipo.length > 0 && (
                <p className="mt-1 text-xs text-rose-400">{errores.tipo}</p>
              )}
            </div>

            <CampoTexto
              etiqueta="Entrevistador"
              valor={wizard.entrevistador}
              onCambio={cambiar('entrevistador')}
              error={errores.entrevistador}
            />
            <CampoTexto
              etiqueta="Notas"
              valor={wizard.notas}
              onCambio={cambiar('notas')}
              error={errores.notas}
            />

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={enviando || wizard.postulaciones.length === 0}
                className={CLASE_BOTON_PRINCIPAL}
              >
                {enviando ? 'Agendando…' : 'Agendar'}
              </button>
              {enviando && <Spinner texto="Guardando entrevista…" />}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
