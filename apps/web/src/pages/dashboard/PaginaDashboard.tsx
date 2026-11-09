import { solicitud } from '../../lib/api';
import { ETIQUETA_FASE } from '../../lib/embudo';
import { useRecurso } from '../../lib/useRecurso';
import type { Dashboard } from '../../tipos';
import { MensajeError, Spinner } from '../../components/ui/feedback';
import { Paginacion } from '../../components/ui/datos';
import { CLASE_TARJETA } from '../../components/ui/estilos';
import { useState } from 'react';

/**
 * Dashboard operativo (`/dashboard`, Etapa 9): tarjetas de totales del embudo
 * y de requerimientos, y el embudo de contratación con las 5 fases (nombres
 * de la muestra) + su tasa de retención.
 *
 * Los datos llegan de `GET /api/dashboard` en UNA sola llamada; la API
 * garantiza las 5 fases SIEMPRE en orden (incluso con cantidad 0), así que
 * este componente solo las pinta en el orden recibido.
 */

/** Tarjeta de una cifra resumida (total, en proceso, …). */
function TarjetaCifra({
  etiqueta,
  valor,
  color,
}: {
  etiqueta: string;
  valor: number;
  color: string;
}) {
  return (
    <div className={`${CLASE_TARJETA} py-4`}>
      <p className={`text-3xl font-bold ${color}`}>{valor.toLocaleString('es-CO')}</p>
      <p className="mt-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
        {etiqueta}
      </p>
    </div>
  );
}

/** Formato de porcentaje de retención: `0.957` → `95.7%`. */
function porcentaje(tasa: number): string {
  return `${(tasa * 100).toFixed(1)}%`;
}

function porcentajeContratacion(tasa: number): string {
  return `${(tasa * 100).toFixed(1)}%`;
}

export function PaginaDashboard() {
  const [pagina, setPagina] = useState(1);
  const recurso = useRecurso<Dashboard>(
    () => solicitud<Dashboard>(`/dashboard?page=${pagina}&limit=10`),
    [pagina],
  );

  if (recurso.fase === 'cargando' && recurso.datos === null) {
    return <Spinner texto="Cargando dashboard…" />;
  }
  if (recurso.fase === 'error' || recurso.datos === null) {
    return (
      <MensajeError
        mensaje={recurso.error ?? 'No se pudo cargar el dashboard'}
        onReintentar={recurso.recargar}
      />
    );
  }

  const { embudo, porFase, requerimientos, conversionPorRequerimiento } = recurso.datos;
  const maximoFase = Math.max(1, ...porFase.map((fase) => fase.cantidad));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Dashboard — Embudo RRHH</h1>
        <p className="mt-1 text-sm text-slate-400">
          Resumen operativo de la selección de personal LARCO.
        </p>
      </div>

      {/* Cifras principales del embudo de candidatos. */}
      <section aria-label="Totales del embudo" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TarjetaCifra
          etiqueta="Total candidatos"
          valor={embudo.totalCandidatos}
          color="text-slate-100"
        />
        <TarjetaCifra etiqueta="En proceso" valor={embudo.enProceso} color="text-emerald-400" />
        <TarjetaCifra etiqueta="Descartados" valor={embudo.descartados} color="text-rose-400" />
        <TarjetaCifra etiqueta="Contratados" valor={embudo.contratados} color="text-amber-400" />
      </section>

      {/* Embudo de contratación: 5 barras con las fases de la muestra. */}
      <section aria-label="Estado del embudo de contratación" className={CLASE_TARJETA}>
        <h2 className="mb-4 text-sm font-semibold text-slate-200">
          Estado del Embudo de Contratación
        </h2>
        <div className="flex items-end gap-3 overflow-x-auto pb-2" role="list">
          {porFase.map((fase, indice) => {
            const altura = Math.max(4, Math.round((fase.cantidad / maximoFase) * 140));
            return (
              <div
                key={fase.fase}
                role="listitem"
                aria-label={`${ETIQUETA_FASE[fase.fase]}: ${fase.cantidad} activas`}
                className="flex w-40 shrink-0 flex-col items-center gap-1"
              >
                <span className="text-lg font-bold text-slate-100">{fase.cantidad}</span>
                <span className="text-[10px] text-slate-500">
                  {porcentaje(fase.tasaRetencion)} retención
                </span>
                <div
                  className="w-full rounded-t-lg border border-sky-500/40 bg-sky-500/15"
                  style={{ height: `${altura}px` }}
                />
                <span className="text-center text-[11px] leading-tight font-medium text-slate-300">
                  {indice + 1}. {ETIQUETA_FASE[fase.fase]}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Requerimientos por estado. */}
      <section aria-label="Requerimientos" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <TarjetaCifra
          etiqueta="Requerimientos"
          valor={requerimientos.total}
          color="text-slate-100"
        />
        <TarjetaCifra etiqueta="Aprobados" valor={requerimientos.aprobados} color="text-sky-400" />
        <TarjetaCifra
          etiqueta="Pendientes"
          valor={requerimientos.pendientes}
          color="text-amber-400"
        />
        <TarjetaCifra
          etiqueta="En proceso"
          valor={requerimientos.enProceso}
          color="text-violet-400"
        />
        <TarjetaCifra etiqueta="Críticos" valor={requerimientos.criticos} color="text-rose-400" />
      </section>

      <section aria-label="Conversión a contratado por requerimiento" className={CLASE_TARJETA}>
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          Conversión a contratado por requerimiento
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Contratados ÷ postulaciones registradas; los requerimientos sin postulaciones muestran 0%.
        </p>
        {conversionPorRequerimiento.items.length === 0 ? (
          <p className="text-sm text-slate-500">No hay requerimientos registrados.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="border-b border-slate-800 text-xs text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Requerimiento</th>
                    <th className="px-2 py-2">Postulaciones</th>
                    <th className="px-2 py-2">Contratados</th>
                    <th className="px-2 py-2">Conversión</th>
                  </tr>
                </thead>
                <tbody>
                  {conversionPorRequerimiento.items.map((fila) => (
                    <tr
                      key={fila.requerimientoId}
                      className="border-b border-slate-800/70 last:border-0"
                    >
                      <td className="px-2 py-2 text-slate-300">
                        <span className="font-medium text-slate-200">{fila.codigo}</span>
                        <span className="ml-2 text-xs text-slate-500">{fila.titulo}</span>
                      </td>
                      <td className="px-2 py-2 text-slate-300">{fila.postulaciones}</td>
                      <td className="px-2 py-2 text-amber-300">{fila.contratados}</td>
                      <td className="px-2 py-2 font-semibold text-emerald-300">
                        {porcentajeContratacion(fila.tasaContratacion)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion
              pagina={conversionPorRequerimiento.page}
              total={conversionPorRequerimiento.total}
              limit={conversionPorRequerimiento.limit}
              onCambio={setPagina}
            />
          </>
        )}
      </section>
    </div>
  );
}
