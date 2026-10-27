import { create } from 'zustand';

import { mensajeDeError, solicitud } from '../lib/api';
import {
  ETIQUETA_FASE,
  esSiguienteFase,
  esTerminal,
  estadoTrasMover,
  mensajeCupoLleno,
  mensajeFaseActual,
  mensajeSoloAvanza,
  mensajeTerminal,
} from '../lib/embudo';
import type { FasePostulacion, Pagina, Postulacion } from '../tipos';

/**
 * Almacén del tablero Kanban del embudo de selección (Zustand SIN persistencia:
 * las postulaciones viven en el servidor y cada visita las recarga).
 *
 * PATRÓN OPTIMISTA CON ROLLBACK (la razón de ser de este store):
 *  - Al soltar una tarjeta en otra columna, `mover()` la mueve AL INSTANTE en
 *    la UI (antes de la respuesta del servidor) para que el drag-and-drop se
 *    sienta instantáneo; nadie quiere esperar un RTT para ver la tarjeta en
 *    su columna.
 *  - El SERVIDOR es la verdad: `PATCH /:id/fase` valida adyacencia, estado
 *    terminal y carreras. Si responde con error (p. ej. 409 por una carrera),
 *    se hace ROLLBACK de la tarjeta a su fase/estado ANTERIORES y el error se
 *    muestra en la UI (nunca en silencio).
 *  - En ÉXITO se reconcilia con la fila que devuelve el servidor (fase,
 *    estado y `updatedAt` reales), no con lo que el cliente supuso: la
 *    respuesta de la API corrige cualquier desvío del optimismo (p. ej. si
 *    el servidor aplicó efectivamente `contratacion` ⇒ `contratado`).
 *
 * ATAJO LOCAL DE UX (documentado en `lib/embudo.ts`): si el usuario suelta la
 * tarjeta en una fase que NO es la siguiente (atrás o saltando), NI siquiera
 * se llama al servidor (que respondería 409): no se mueve nada y se muestra
 * «El embudo solo avanza». Lo mismo con el cupo lleno hacia `contratacion`.
 * Son atajos; si algún día la regla cambiara, el servidor seguiría siendo
 * quien decide.
 */

/**
 * Tamaño de página del listado: el tablero pinta TODO el embudo de golpe.
 *
 * 100 es el MÁXIMO que admite `ListPostulacionesQueryDto` (la API responde
 * 400 «limit no puede superar 100» por encima). Si un requerimiento supera
 * esas 100 postulaciones, el tablero mostraría solo las 100 más recientes:
 * por ahora es un límite aceptable para el piloto; escalarlo exige
 * paginación o scroll infinito en la UI.
 */
const LIMITE_LISTADO = 100;

export interface EstadoTablero {
  /** Postulaciones del requerimiento abierto (cualquier fase/estado). */
  postulaciones: Postulacion[];
  /** Requerimiento al que pertenece el tablero (para `agregar`). */
  requerimientoId: string | null;
  cargando: boolean;
  /** Último error visible (carga, movimiento con rollback, descarte…). */
  error: string | null;
  /** Confirmación de una operación que terminó bien. */
  exito: string | null;
  /** Ids de postulaciones con una mutación en vuelo (deshabilita sus botones). */
  guardando: string[];
  /** Carga (o recarga) el tablero del requerimiento dado. */
  cargar: (requerimientoId: string) => Promise<void>;
  /**
   * Mueve la postulación a la fase SIGUIENTE con actualización OPTIMISTA y
   * rollback en fallo (el embudo SOLO AVANZA: un paso adelante). Si el
   * destino es `contratacion`, `numeroPlazas` permite anticipar el 409 de cupo
   * lleno sin viaje de red. Devuelve `true` si el servidor confirmó.
   */
  mover: (id: string, destino: FasePostulacion, numeroPlazas: number | null) => Promise<boolean>;
  /** Descarta con motivo obligatorio (POST; éxito → estado `descartado`). */
  descartar: (id: string, motivo: string) => Promise<boolean>;
  /** Da de alta una postulación del candidato dado en ESTE requerimiento. */
  agregar: (candidatoId: string) => Promise<Postulacion | null>;
  /** Limpia los mensajes de error/éxito visibles. */
  limpiarMensajes: () => void;
}

/** Aplica `fn` solo a la postulación `id` (inmutabilidad: array nuevo). */
function actualizarPostulacion(
  lista: Postulacion[],
  id: string,
  fn: (postulacion: Postulacion) => Postulacion,
): Postulacion[] {
  return lista.map((postulacion) => (postulacion.id === id ? fn(postulacion) : postulacion));
}

export const useTableroStore = create<EstadoTablero>()((set, get) => ({
  postulaciones: [],
  requerimientoId: null,
  cargando: false,
  error: null,
  exito: null,
  guardando: [],

  cargar: async (requerimientoId) => {
    set({ cargando: true, error: null, requerimientoId });
    try {
      const pagina = await solicitud<Pagina<Postulacion>>(
        `/postulaciones?requerimientoId=${encodeURIComponent(requerimientoId)}` +
          `&page=1&limit=${LIMITE_LISTADO}`,
      );
      set({ postulaciones: pagina.items, cargando: false });
    } catch (capturado) {
      set({
        postulaciones: [],
        cargando: false,
        error: mensajeDeError(capturado, 'No se pudo cargar el tablero de selección'),
      });
    }
  },

  mover: async (id, destino, numeroPlazas) => {
    const { postulaciones } = get();
    const actual = postulaciones.find((postulacion) => postulacion.id === id);
    if (actual === undefined) return false;

    // Validación local ANTES de tocar nada: evita el viaje de red (y el
    // rollback) cuando el servidor ya sabríamos que diría 409.
    if (esTerminal(actual.estado)) {
      set({ error: mensajeTerminal(actual.estado, 'nuevos movimientos de fase') });
      return false;
    }
    if (actual.fase === destino) {
      set({ error: mensajeFaseActual(destino) });
      return false;
    }
    // SOLO AVANZA (retroalimentación Etapa 9): sin retroceso ni saltos.
    if (!esSiguienteFase(actual.fase, destino)) {
      set({ error: mensajeSoloAvanza(actual.fase, destino) });
      return false;
    }
    // Cupo lleno (retroalimentación Etapa 9): si todas las plazas ya están
    // cubiertas, el servidor rechaza con 409 cualquier movimiento a
    // `contratacion`; el atajo local evita la llamada y el rollback.
    if (destino === 'contratacion' && numeroPlazas !== null) {
      const contratados = postulaciones.filter(
        (postulacion) => postulacion.estado === 'contratado',
      ).length;
      if (contratados >= numeroPlazas) {
        set({ error: mensajeCupoLleno(numeroPlazas) });
        return false;
      }
    }

    // COPIA previa para el posible rollback (referencia inmutable: `set`
    // siempre construye un array nuevo, así que esta copia no se corrompe).
    const anterior = actual;
    const estadoOptimista = estadoTrasMover(destino);
    set({
      error: null,
      exito: null,
      guardando: [...get().guardando, id],
      postulaciones: actualizarPostulacion(postulaciones, id, (postulacion) => ({
        ...postulacion,
        fase: destino,
        estado: estadoOptimista,
      })),
    });

    try {
      // SOLO `{ fase }`: el DTO del servidor prohíbe `estado`/`motivo` con 400
      // (`forbidNonWhitelisted`); el estado resultANTE lo decide el backend.
      const confirmada = await solicitud<Postulacion>(`/postulaciones/${id}/fase`, {
        metodo: 'PATCH',
        cuerpo: { fase: destino },
      });
      // Reconciliación con la verdad del servidor (fase/estado/updatedAt reales).
      set({
        postulaciones: actualizarPostulacion(get().postulaciones, id, () => confirmada),
        guardando: get().guardando.filter((guardando) => guardando !== id),
        exito:
          `${confirmada.candidato.nombres} ${confirmada.candidato.apellidos} → ` +
          `${ETIQUETA_FASE[confirmada.fase]}`,
      });
      return true;
    } catch (capturado) {
      // ROLLBACK: la tarjeta vuelve EXACTAMENTE a su fase y estado previos.
      set({
        postulaciones: actualizarPostulacion(get().postulaciones, id, () => anterior),
        guardando: get().guardando.filter((guardando) => guardando !== id),
        error: mensajeDeError(capturado, 'No se pudo mover la postulación'),
      });
      return false;
    }
  },

  descartar: async (id, motivo) => {
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      set({ error: 'El motivo de descarte es obligatorio' });
      return false;
    }
    set({
      error: null,
      exito: null,
      guardando: [...get().guardando, id],
    });
    try {
      const descartada = await solicitud<Postulacion>(`/postulaciones/${id}/descarte`, {
        metodo: 'POST',
        cuerpo: { motivo: motivoLimpio },
      });
      set({
        postulaciones: actualizarPostulacion(get().postulaciones, id, () => descartada),
        guardando: get().guardando.filter((guardando) => guardando !== id),
        exito: `${descartada.candidato.nombres} ${descartada.candidato.apellidos} descartada`,
      });
      return true;
    } catch (capturado) {
      set({
        guardando: get().guardando.filter((guardando) => guardando !== id),
        error: mensajeDeError(capturado, 'No se pudo descartar la postulación'),
      });
      return false;
    }
  },

  agregar: async (candidatoId) => {
    const requerimientoId = get().requerimientoId;
    if (requerimientoId === null) {
      set({ error: 'No hay un requerimiento abierto en el tablero' });
      return null;
    }
    set({ error: null, exito: null });
    try {
      const creada = await solicitud<Postulacion>('/postulaciones', {
        metodo: 'POST',
        cuerpo: { candidatoId, requerimientoId },
      });
      set({
        postulaciones: [...get().postulaciones, creada],
        exito:
          `${creada.candidato.nombres} ${creada.candidato.apellidos} añadida a ` +
          `${ETIQUETA_FASE[creada.fase]}`,
      });
      return creada;
    } catch (capturado) {
      // El 409 del servidor ya trae un mensaje claro: «ya tiene una
      // postulación…» o «el requerimiento no está en proceso»; el 403 dirá
      // que el rol no tiene permisos. Aquí solo se hace visible.
      set({ error: mensajeDeError(capturado, 'No se pudo registrar la postulación') });
      return null;
    }
  },

  limpiarMensajes: () => set({ error: null, exito: null }),
}));
