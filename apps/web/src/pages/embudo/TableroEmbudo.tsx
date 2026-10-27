import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { interpretarSoltar } from '../../lib/embudo';
import { solicitud } from '../../lib/api';
import { puedeAgregarPostulaciones, puedeMoverPostulaciones } from '../../lib/rbac';
import { useRecurso } from '../../lib/useRecurso';
import { useSesionStore } from '../../store/sesion';
import { useTableroStore } from '../../store/tablero';
import {
  FASES_POSTULACION,
  type FasePostulacion,
  type Postulacion,
  type Requerimiento,
} from '../../tipos';
import { ColumnaEmbudo } from '../../components/embudo/ColumnaEmbudo';
import { DialogoDescarte } from '../../components/embudo/DialogoDescarte';
import { FormularioAgregarPostulacion } from '../../components/embudo/FormularioAgregarPostulacion';
import { PanelHistorial } from '../../components/embudo/PanelHistorial';
import { BadgeEstado } from '../../components/ui/datos';
import { AvisoExito, EstadoVacio, MensajeError, Spinner } from '../../components/ui/feedback';
import { CLASE_BOTON_SECUNDARIO, CLASE_TARJETA } from '../../components/ui/estilos';

/**
 * Tablero Kanban del embudo de selección (`/requerimientos/:id/embudo`).
 *
 * 5 columnas (una por fase, EN ORDEN) con las postulaciones del requerimiento
 * agrupadas por su `fase`. El arrastre usa `DndContext` de dnd-kit con sensor
 * de puntero Y de teclado (accesibilidad); al soltar en una columna se invoca
 * `mover(id, faseDestina)` del store, que aplica el cambio de forma OPTIMISTA
 * y hace rollback si el servidor lo rechaza.
 *
 * ATAJOS LOCALES (ver `lib/embudo.ts`): soltar en la MISMA columna o en una
 * no adyacente NO genera viaje de red — el store lo resuelve con un mensaje
 * («Solo se puede mover un paso»).
 *
 * SOLO LECTURA: el tablero es editable solo si (a) el requerimiento está
 * `en_proceso` (fuera de ese estado la API responde 409) y (b) el rol es
 * `analista_seleccion`, `admin_rrhh` o `superusuario` (el resto recibiría
 * 403). En otro caso el tablero se pinta con un aviso y SIN acciones.
 */
export function TableroEmbudo() {
  const parametros = useParams();
  const id = parametros.id ?? '';
  const rol = useSesionStore((sesion) => sesion.usuario?.role ?? null);

  const [postulacionDescarte, setPostulacionDescarte] = useState<Postulacion | null>(null);
  const [postulacionHistorial, setPostulacionHistorial] = useState<Postulacion | null>(null);
  const [mostrarAlta, setMostrarAlta] = useState(false);

  const recursoRequerimiento = useRecurso<Requerimiento>(
    () => solicitud<Requerimiento>(`/requerimientos/${id}`),
    [id],
  );

  const {
    postulaciones,
    cargando,
    error,
    exito,
    guardando,
    cargar,
    mover,
    descartar,
    agregar,
    limpiarMensajes,
  } = useTableroStore();

  useEffect(() => {
    // Al montar (o cambiar de requerimiento) se carga el tablero completo y
    // se limpian mensajes/herencias del tablero anterior.
    limpiarMensajes();
    void cargar(id);
  }, [id, cargar, limpiarMensajes]);

  // Sensores de dnd-kit: puntero con umbral de 6px (distingue clic de
  // arrastre) y teclado (Space toma, flechas mueven, Space suelta).
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const requerimiento = recursoRequerimiento.datos;
  const enProceso = requerimiento?.estado === 'en_proceso';
  const editable = enProceso && puedeMoverPostulaciones(rol);
  const puedeDarDeAlta = enProceso && puedeAgregarPostulaciones(rol);

  // Regla 2 (Etapa 9): los DESCARTADOS NO se pintan en el tablero — siguen
  // siendo datos del embudo (el dashboard y el historial los cuentan), pero el
  // kanban es la vista del trabajo EN CURSO. Los CONTRATADOS sí permanecen
  // visibles (regla 8) y ya no son reasignables (estado terminal).
  const visibles = postulaciones.filter((postulacion) => postulacion.estado !== 'descartado');

  // Regla 4 (Etapa 9): con el cupo completo (plazas cubiertas) NO se admiten
  // altas ni movimientos hacia Contratación; el servidor también responde 409.
  const numeroPlazas = requerimiento?.numeroPlazas ?? null;
  const contratados = postulaciones.filter(
    (postulacion) => postulacion.estado === 'contratado',
  ).length;
  const cupoLleno = numeroPlazas !== null && contratados >= numeroPlazas;

  /**
   * Al soltar una tarjeta: `over.id` es la FASE de la columna destino (el
   * `useDroppable` la usa como id). `interpretarSoltar` decide si hay drop
   * válido; el store resuelve «solo avanza» y el cupo (mensajes SIN viaje de
   * red).
   */
  const alSoltar = (evento: DragEndEvent) => {
    const decision = interpretarSoltar(editable, evento.active.id, evento.over?.id);
    if (!decision.procede || decision.id === undefined || decision.fase === undefined) return;
    void mover(decision.id, decision.fase, numeroPlazas);
  };

  // Agrupación por fase para pintar cada columna (la fase de la tarjeta manda,
  // no la columna en la que se renderiza).
  const porFase = new Map<FasePostulacion, Postulacion[]>();
  for (const fase of FASES_POSTULACION) porFase.set(fase, []);
  for (const postulacion of visibles) {
    const lista = porFase.get(postulacion.fase);
    if (lista !== undefined) lista.push(postulacion);
  }

  const nombreDescarte =
    postulacionDescarte === null
      ? ''
      : `${postulacionDescarte.candidato.nombres} ${postulacionDescarte.candidato.apellidos}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{requerimiento?.code ?? '…'}</p>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            Tablero de selección
            {requerimiento !== null && requerimiento !== undefined
              ? ` — ${requerimiento.titulo}`
              : ''}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {requerimiento !== null && requerimiento !== undefined && (
            <BadgeEstado estado={requerimiento.estado} />
          )}
          <Link to={`/requerimientos/${id}`} className={CLASE_BOTON_SECUNDARIO}>
            ← Volver al requerimiento
          </Link>
        </div>
      </div>

      {!enProceso && recursoRequerimiento.fase === 'listo' && (
        <p className="rounded-lg border border-amber-600/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          Este requerimiento no está «En proceso»: el tablero se muestra en SOLO LECTURA (la API
          rechaza movimientos y altas con un 409). El tablero se usa durante el proceso de
          selección.
        </p>
      )}
      {enProceso && !puedeMoverPostulaciones(rol) && (
        <p className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
          Tu rol puede CONSULTAR el tablero, pero no mover postulaciones ni descartar candidatos (la
          API es la autoridad: recibirías un 403).
        </p>
      )}

      {exito !== null && <AvisoExito mensaje={exito} />}
      {/* Error de MUTACIÓN con el tablero ya cargado (arriba, con «Entendido»). */}
      {error !== null && postulaciones.length > 0 && postulacionDescarte === null && (
        <MensajeError mensaje={error} onReintentar={limpiarMensajes} textoReintentar="Entendido" />
      )}

      {puedeDarDeAlta && (
        <section className={CLASE_TARJETA}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-200">Agregar candidato al tablero</h2>
            <button
              type="button"
              onClick={() => setMostrarAlta((anterior) => !anterior)}
              disabled={cupoLleno}
              title={
                cupoLleno
                  ? `Las ${numeroPlazas} plazas ya están cubiertas: no se admiten más postulaciones`
                  : undefined
              }
              className={CLASE_BOTON_SECUNDARIO}
            >
              {mostrarAlta ? 'Ocultar' : 'Agregar candidato'}
            </button>
          </div>
          {cupoLleno && (
            <p className="mt-2 text-xs text-amber-300">
              Las {numeroPlazas} plazas de este requerimiento ya están cubiertas: se bloquean nuevas
              altas y movimientos hacia Contratación.
            </p>
          )}
          {mostrarAlta && !cupoLleno && (
            <div className="mt-3">
              <FormularioAgregarPostulacion
                onAgregar={async (candidatoId) => (await agregar(candidatoId)) !== null}
              />
            </div>
          )}
        </section>
      )}

      {cargando && visibles.length === 0 && <Spinner texto="Cargando tablero…" />}
      {!cargando && error !== null && visibles.length === 0 && (
        <MensajeError mensaje={error} onReintentar={() => void cargar(id)} />
      )}
      {!cargando && error === null && visibles.length === 0 && (
        <EstadoVacio mensaje="Sin postulaciones activas en este requerimiento" />
      )}

      {visibles.length > 0 && (
        <DndContext sensors={sensores} onDragEnd={alSoltar}>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {FASES_POSTULACION.map((fase) => (
              <ColumnaEmbudo
                key={fase}
                fase={fase}
                postulaciones={porFase.get(fase) ?? []}
                movible={editable}
                cupoLleno={cupoLleno}
                guardando={guardando}
                onMover={(idPostulacion, destino) =>
                  void mover(idPostulacion, destino, numeroPlazas)
                }
                onDescartar={setPostulacionDescarte}
                onHistorial={setPostulacionHistorial}
              />
            ))}
          </div>
        </DndContext>
      )}

      {postulacionDescarte !== null && (
        <DialogoDescarte
          nombreCandidato={nombreDescarte}
          enviando={guardando.includes(postulacionDescarte.id)}
          error={error}
          onConfirmar={(motivo) => {
            void descartar(postulacionDescarte.id, motivo).then((ok) => {
              if (ok) setPostulacionDescarte(null);
            });
          }}
          onCancelar={() => {
            limpiarMensajes();
            setPostulacionDescarte(null);
          }}
        />
      )}

      {postulacionHistorial !== null && (
        <PanelHistorial
          postulacionId={postulacionHistorial.id}
          nombreCandidato={`${postulacionHistorial.candidato.nombres} ${postulacionHistorial.candidato.apellidos}`}
          onCerrar={() => setPostulacionHistorial(null)}
        />
      )}
    </div>
  );
}
