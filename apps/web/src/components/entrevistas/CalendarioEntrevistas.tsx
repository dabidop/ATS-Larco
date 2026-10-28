import { useMemo, useState } from 'react';

import { solicitud } from '../../lib/api';
import { useRecurso } from '../../lib/useRecurso';
import { ESTADOS_ENTREVISTA, type Entrevista, type EstadoEntrevista } from '../../tipos';
import { MensajeError, Spinner } from '../../components/ui/feedback';
import { CLASE_BOTON_SECUNDARIO, CLASE_ETIQUETA } from '../../components/ui/estilos';

/**
 * Calendario mensual de entrevistas (`/entrevistas`, corrección posterior a la
 * Etapa 9): refleje las entrevistas del mes Y SU ESTADO en una rejilla de
 * 7 columnas (Lun–Dom), con navegación por mes y el día de hoy resaltado.
 *
 * ES AUTÓNOMO: trae sus propios datos con `GET /api/entrevistas?desde&hasta`
 * (filtros que ya resuelve la API) según el mes visible, así no depende de los
 * filtros de la agenda ni de su paginación, y mover un filtro de la tabla no
 * desordena la rejilla. Cada día es una celda con un chip POR ENTREVISTA
 * coloreado por estado (misma gama que la tabla) y con la hora encima.
 *
 * Las fechas se manipulan SIEMPRE como calendario local (`new Date(a, m, d)`
 * + `getDate()`), nunca con `new Date('YYYY-MM-DD')`: el navegador interpretaría
 * esa cadena como UTC y en husos al oeste de Greenwich el día saldría corrido.
 */

/** Etiqueta legible de cada estado (misma que la agenda). */
const ETIQUETA_ESTADO: Readonly<Record<EstadoEntrevista, string>> = {
  agendada: 'Agendada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
};

/** Color del chip por estado (misma gama de colores que la tabla). */
const CLASES_ESTADO: Readonly<Record<EstadoEntrevista, string>> = {
  agendada: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  realizada: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  cancelada: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
};

/** Cabecera de la rejilla: semana ISO (lunes primero). */
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

/** Meses en minúsculas para la cabecera («octubre de 2026»). */
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** Chips visibles por día antes de colapsar en «+N». */
const MAXIMO_POR_DIA = 3;

/** Dos dígitos (`05`) para las claves `YYYY-MM-DD`. */
function dosDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/** Fecha de calendario → clave `YYYY-MM-DD` (partes LOCALES, sin hora). */
function aClave(fecha: Date): string {
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;
}

/** ¿La clave `YYYY-MM-DD` corresponde a `hoy`? */
function esHoy(clave: string, hoy: Date): boolean {
  return clave === aClave(hoy);
}

/** Día de la semana de `fecha` en 0..6 empezando por el LUNES. */
function diaLunesPrimero(fecha: Date): number {
  return (fecha.getDay() + 6) % 7;
}

/** Estado de una entrevista si pertenece a los 3 del ENUM (degrada a «agendada»). */
function estadoDe(entrevista: Entrevista): EstadoEntrevista {
  return (ESTADOS_ENTREVISTA as readonly string[]).includes(entrevista.estado)
    ? (entrevista.estado as EstadoEntrevista)
    : 'agendada';
}

/** Una celda de la rejilla: su fecha y las entrevistas de ese día. */
interface DiaCalendario {
  clave: string;
  numero: number;
  entrevistas: Entrevista[];
}

/**
 * Calendario del mes visible. Sin props: su estado (el mes) es SUYO, igual que
 * sus datos.
 */
export function CalendarioEntrevistas() {
  const [hoy] = useState(() => new Date());
  const [mes, setMes] = useState(() => new Date(hoy.getFullYear(), hoy.getMonth(), 1));

  const desde = aClave(mes);
  const hasta = aClave(new Date(mes.getFullYear(), mes.getMonth() + 1, 0));

  const recurso = useRecurso<Entrevista[]>(() => {
    return solicitud<Entrevista[]>(`/entrevistas?desde=${desde}&hasta=${hasta}`);
  }, [desde, hasta]);

  const entrevistas = useMemo(() => recurso.datos ?? [], [recurso.datos]);

  const dias = useMemo<DiaCalendario[]>(() => {
    const total = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
    const porClave = new Map<string, Entrevista[]>();
    for (const entrevista of entrevistas) {
      const anteriores = porClave.get(entrevista.fecha) ?? [];
      anteriores.push(entrevista);
      porClave.set(entrevista.fecha, anteriores);
    }
    const casillas: DiaCalendario[] = [];
    for (let numero = 1; numero <= total; numero += 1) {
      const clave = aClave(new Date(mes.getFullYear(), mes.getMonth(), numero));
      casillas.push({ clave, numero, entrevistas: porClave.get(clave) ?? [] });
    }
    return casillas;
  }, [mes, entrevistas]);

  // Huecos iniciales para alinear el día 1 bajo su columna (lunes primero).
  const huecos = diaLunesPrimero(new Date(mes.getFullYear(), mes.getMonth(), 1));

  const cambiarMes = (desplazamiento: number) => {
    setMes((anterior) => new Date(anterior.getFullYear(), anterior.getMonth() + desplazamiento, 1));
  };

  return (
    <section className="rounded-xl border border-slate-800 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Calendario del mes
          </h2>
          <p className="text-xs text-slate-500">
            {MESES[mes.getMonth()]} de {mes.getFullYear()} · {entrevistas.length}{' '}
            {entrevistas.length === 1 ? 'entrevista' : 'entrevistas'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => cambiarMes(-1)}
            className={CLASE_BOTON_SECUNDARIO}
            aria-label="Mes anterior"
          >
            ‹ Anterior
          </button>
          <button
            type="button"
            onClick={() => cambiarMes(1)}
            className={CLASE_BOTON_SECUNDARIO}
            aria-label="Mes siguiente"
          >
            Siguiente ›
          </button>
        </div>
      </div>

      {/* Leyenda de estados: el color del chip ES el estado. */}
      <ul className="mb-3 flex flex-wrap gap-3 text-xs text-slate-400">
        {ESTADOS_ENTREVISTA.map((estado) => (
          <li key={estado} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 rounded-full border ${CLASES_ESTADO[estado]}`}
            />
            {ETIQUETA_ESTADO[estado]}
          </li>
        ))}
      </ul>

      {recurso.fase === 'cargando' && entrevistas.length === 0 && (
        <Spinner texto="Cargando calendario…" />
      )}
      {recurso.fase === 'error' && entrevistas.length === 0 && (
        <MensajeError
          mensaje={recurso.error ?? 'No se pudo cargar el calendario'}
          onReintentar={recurso.recargar}
        />
      )}

      {(entrevistas.length > 0 || recurso.fase === 'listo') && (
        <div className="overflow-x-auto">
          <div className="grid min-w-[560px] grid-cols-7 gap-1">
            {DIAS_SEMANA.map((dia) => (
              <div key={dia} className={`${CLASE_ETIQUETA} px-1 py-1 text-center`}>
                {dia}
              </div>
            ))}
            {Array.from({ length: huecos }, (_, indice) => (
              <div key={`hueco-${indice}`} aria-hidden="true" />
            ))}
            {dias.map((dia) => {
              const esHoyCelda = esHoy(dia.clave, hoy);
              const visibles = dia.entrevistas.slice(0, MAXIMO_POR_DIA);
              const resto = dia.entrevistas.length - visibles.length;
              return (
                <div
                  key={dia.clave}
                  className={`min-h-[92px] rounded-lg border p-1 ${
                    esHoyCelda
                      ? 'border-emerald-500/70 bg-emerald-500/10'
                      : 'border-slate-800 bg-slate-950/40'
                  }`}
                >
                  <span
                    className={`text-xs font-semibold ${
                      esHoyCelda ? 'text-emerald-300' : 'text-slate-400'
                    }`}
                  >
                    {dia.numero}
                    {esHoyCelda && <span className="ml-1 font-normal">hoy</span>}
                  </span>
                  {visibles.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {visibles.map((entrevista) => {
                        const estado = estadoDe(entrevista);
                        return (
                          <li
                            key={entrevista.id}
                            title={`${entrevista.candidato.nombre} — ${entrevista.requerimiento.codigo} · ${ETIQUETA_ESTADO[estado]}`}
                            className={`rounded border px-1 py-0.5 text-[11px] leading-tight ${CLASES_ESTADO[estado]}`}
                          >
                            <span className="font-semibold">{entrevista.hora ?? '—'}</span>{' '}
                            <span className="truncate">{entrevista.candidato.nombre}</span>
                          </li>
                        );
                      })}
                      {resto > 0 && <li className="text-[11px] text-slate-500">+{resto} más</li>}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {recurso.fase === 'listo' && entrevistas.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">Sin entrevistas en este mes.</p>
      )}
    </section>
  );
}
