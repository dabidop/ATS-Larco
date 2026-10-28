import { useState } from 'react';

import { solicitud } from '../../lib/api';
import { ETIQUETA_ACCION_HISTORIAL } from '../../lib/embudo';
import { fechaHora, valorHistorial } from '../../lib/formato';
import { useRecurso } from '../../lib/useRecurso';
import type { EntradaAuditoria, PaginaAuditoria } from '../../tipos';
import { EstadoVacio, MensajeError, Spinner } from '../../components/ui/feedback';
import { CLASE_BOTON_SECUNDARIO, CLASE_CAMPO, CLASE_ETIQUETA } from '../../components/ui/estilos';

/**
 * Bitácora de auditoría (`/bitacora`, Etapa 9, regla 7): SOLO `superusuario`
 * (la ruta está protegida en `App.tsx` y la API responde 03 al resto).
 *
 * Muestra `audit_log` paginado (quién cambió qué y cuándo) con el diff campo
 * a campo. Los valores sensibles llegan YA ENMASCARADOS del servidor como
 * `[PROTEGIDO]` (PII cifrada y hashes): el front nunca ve PII cruda aquí.
 */

/** Color del badge por acción (alta/cambio/borrado). */
const CLASES_ACCION: Readonly<Record<EntradaAuditoria['accion'], string>> = {
  INSERT: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  UPDATE: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  DELETE: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
};

const LIMITE = 25;

/** Fila de la bitácora con su diff desplegable. */
function EntradaAuditoriaFila({ entrada }: { entrada: EntradaAuditoria }) {
  const [abierta, setAbierta] = useState(false);

  return (
    <li className="border-t border-slate-800 px-3 py-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span
          className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${CLASES_ACCION[entrada.accion]}`}
        >
          {ETIQUETA_ACCION_HISTORIAL[entrada.accion] ?? entrada.accion}
        </span>
        <span className="font-medium text-slate-100">{entrada.tabla}</span>
        <span className="text-xs text-slate-500">
          {entrada.etiqueta ?? `registro ${entrada.registroId.slice(0, 8)}…`}
        </span>
        <span className="text-xs text-slate-400">
          {entrada.actor.email ?? '—'} · {fechaHora(entrada.fecha)}
        </span>
        {entrada.cambios.length > 0 && (
          <button
            type="button"
            onClick={() => setAbierta((anterior) => !anterior)}
            className="ml-auto text-xs font-semibold text-emerald-400 hover:text-emerald-300"
          >
            {abierta ? 'Ocultar cambios' : `Ver cambios (${entrada.cambios.length})`}
          </button>
        )}
      </div>
      {abierta && (
        <ul className="mt-2 space-y-1 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
          {entrada.cambios.map((cambio) => (
            <li key={cambio.campo} className="font-mono text-xs break-all text-slate-300">
              <span className="text-slate-500">{cambio.campo}:</span>{' '}
              <span className="text-rose-300">{valorHistorial(cambio.antes)}</span>
              <span className="mx-1 text-slate-500">→</span>
              <span className="text-emerald-300">{valorHistorial(cambio.despues)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function PaginaBitacora() {
  const [pagina, setPagina] = useState(1);
  const [tabla, setTabla] = useState('');

  const recurso = useRecurso<PaginaAuditoria>(() => {
    const parametros = new URLSearchParams({ pagina: String(pagina), limite: String(LIMITE) });
    if (tabla.trim().length > 0) parametros.set('tabla', tabla.trim());
    return solicitud<PaginaAuditoria>(`/historial/auditoria?${parametros.toString()}`);
  }, [pagina, tabla]);

  const entradas = recurso.datos?.entradas ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Bitácora de auditoría</h1>
        <p className="mt-1 text-sm text-slate-400">
          Registro de cambios sobre la información del ATS. Los datos sensibles aparecen como
          [PROTEGIDO]: la bitácora nunca expone PII en claro.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <label htmlFor="bitacora-tabla" className={CLASE_ETIQUETA}>
            Filtrar por tabla
          </label>
          <input
            id="bitacora-tabla"
            value={tabla}
            onChange={(evento) => {
              setTabla(evento.target.value);
              setPagina(1);
            }}
            placeholder="candidatos, postulaciones…"
            className={CLASE_CAMPO}
          />
        </div>
      </div>

      {recurso.fase === 'cargando' && entradas.length === 0 && (
        <Spinner texto="Cargando bitácora…" />
      )}
      {recurso.fase === 'error' && entradas.length === 0 && (
        <MensajeError
          mensaje={recurso.error ?? 'No se pudo cargar la bitácora'}
          onReintentar={recurso.recargar}
        />
      )}
      {recurso.fase === 'listo' && entradas.length === 0 && (
        <EstadoVacio mensaje="Sin registros de auditoría con estos filtros" />
      )}

      {entradas.length > 0 && (
        <ul className="rounded-xl border border-slate-800">
          {entradas.map((entrada) => (
            <EntradaAuditoriaFila key={entrada.id} entrada={entrada} />
          ))}
        </ul>
      )}

      {recurso.datos !== null && recurso.datos.paginas > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-400">
            Página {recurso.datos.pagina} de {recurso.datos.paginas} · {recurso.datos.total}{' '}
            registros
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPagina((anterior) => Math.max(1, anterior - 1))}
              disabled={pagina <= 1}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPagina((anterior) => anterior + 1)}
              disabled={pagina >= recurso.datos.paginas}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
