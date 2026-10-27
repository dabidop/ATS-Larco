import { useState } from 'react';
import type { FormEvent } from 'react';

import { mensajeDeError, solicitud, subirFormulario } from '../../lib/api';
import { tamanoArchivo } from '../../lib/formato';
import { useRecurso } from '../../lib/useRecurso';
import type { Departamento, ResumenImportacion } from '../../tipos';
import { EstadoVacio, MensajeError, Spinner } from '../../components/ui/feedback';
import { CLASE_BOTON_PRINCIPAL, CLASE_CAMPO, CLASE_ETIQUETA } from '../../components/ui/estilos';

/**
 * Importación masiva de HVs (`/importar`, Etapa 9): hasta 50 PDFs de hasta
 * 5 MB cada uno, con destino de departamento (el área LARCO a la que quedan
 * etiquetados los candidatos creados).
 *
 * La importación es POR ARCHIVO (todo-o-nada por archivo, no por lote): un HV
 * ilegible no cancela los demás y la respuesta trae un resultado por fichero,
 * que se pinta aquí. La validación de forma (tipo/tamaño/cantidad) se hace
 * ANTES de subir para no gastar ancho de banda; la autoridad sigue en el
 * servidor (413/400/403).
 */

/** Mismos límites que el servidor (controlador de importación). */
const LIMITE_ARCHIVOS = 50;
const LIMITE_TAMANO = 5 * 1024 * 1024;

export function PaginaImportarHVs() {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [departamentoId, setDepartamentoId] = useState('');
  const [errorArchivos, setErrorArchivos] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resumen, setResumen] = useState<ResumenImportacion | null>(null);

  const departamentos = useRecurso<Departamento[]>(
    () => solicitud<Departamento[]>('/departamentos'),
    [],
  );

  /** Validación local del lote: PDF, ≤5 MB y ≤50 (mismos límites del server). */
  const alElegir = (lista: FileList | null) => {
    setResumen(null);
    setError(null);
    if (lista === null) {
      setArchivos([]);
      return;
    }
    const elegidos = [...lista];
    if (elegidos.length > LIMITE_ARCHIVOS) {
      setErrorArchivos(
        `Un lote admite máximo ${LIMITE_ARCHIVOS} PDFs (elegiste ${elegidos.length})`,
      );
      setArchivos([]);
      return;
    }
    const invalido = elegidos.find(
      (archivo) =>
        (!archivo.name.toLowerCase().endsWith('.pdf') && archivo.type !== 'application/pdf') ||
        archivo.size > LIMITE_TAMANO,
    );
    if (invalido !== undefined) {
      const motivo = invalido.size > LIMITE_TAMANO ? 'supera 5 MB' : 'no es un PDF';
      setErrorArchivos(`«${invalido.name}» ${motivo}: corrige la selección e inténtalo de nuevo`);
      setArchivos([]);
      return;
    }
    setErrorArchivos(null);
    setArchivos(elegidos);
  };

  const alEnviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (archivos.length === 0) {
      setErrorArchivos('Selecciona al menos un PDF');
      return;
    }
    if (departamentoId === '') {
      setError('Elige el departamento destino del lote');
      return;
    }
    const datos = new FormData();
    for (const archivo of archivos) datos.append('archivos', archivo);
    datos.append('departamentoId', departamentoId);

    setEnviando(true);
    setError(null);
    setResumen(null);
    try {
      const resultado = await subirFormulario<ResumenImportacion>('/importacion/hvs', datos);
      setResumen(resultado);
      setArchivos([]);
    } catch (capturado) {
      setError(mensajeDeError(capturado, 'No se pudo importar el lote de HVs'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Importar HVs</h1>
        <p className="mt-1 text-sm text-slate-400">
          Importación masiva de hojas de vida en PDF (máx. {LIMITE_ARCHIVOS} por lote, hasta{' '}
          {tamanoArchivo(LIMITE_TAMANO)} cada una). Cada candidato queda etiquetado con el
          departamento elegido.
        </p>
      </div>

      <form onSubmit={alEnviar} className="space-y-4" noValidate>
        <div>
          <label htmlFor="importar-archivos" className={CLASE_ETIQUETA}>
            Hojas de vida (PDF) *
          </label>
          <input
            id="importar-archivos"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(evento) => alElegir(evento.target.files)}
            className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-200 hover:file:bg-slate-700"
          />
          {errorArchivos !== null && <p className="mt-1 text-xs text-rose-400">{errorArchivos}</p>}
        </div>

        {archivos.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2 text-xs text-slate-300">
            {archivos.map((archivo) => (
              <li key={`${archivo.name}-${archivo.size}`} className="flex justify-between gap-3">
                <span className="truncate">{archivo.name}</span>
                <span className="shrink-0 text-slate-500">{tamanoArchivo(archivo.size)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="max-w-xs">
          <label htmlFor="importar-departamento" className={CLASE_ETIQUETA}>
            Departamento destino *
          </label>
          <select
            id="importar-departamento"
            value={departamentoId}
            onChange={(evento) => setDepartamentoId(evento.target.value)}
            className={CLASE_CAMPO}
          >
            <option value="">(elige un área LARCO)</option>
            {(departamentos.datos ?? []).map((departamento) => (
              <option key={departamento.id} value={departamento.id}>
                {departamento.nombre}
              </option>
            ))}
          </select>
        </div>

        {error !== null && <MensajeError mensaje={error} />}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={enviando || archivos.length === 0}
            className={CLASE_BOTON_PRINCIPAL}
          >
            {enviando
              ? 'Importando…'
              : `Importar ${archivos.length || ''} HV${archivos.length === 1 ? '' : 's'}`}
          </button>
          {enviando && <Spinner texto="Procesando el lote… no cierres la página" />}
        </div>
      </form>

      {resumen !== null && (
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-200">Resultado de la importación</h2>
          <p className="text-sm text-slate-300">
            Procesados: <strong className="text-slate-100">{resumen.procesados}</strong> · Creados:{' '}
            <strong className="text-emerald-400">{resumen.creados}</strong> · Fallidos:{' '}
            <strong className="text-rose-400">{resumen.fallidos}</strong>
          </p>
          {resumen.resultados.length === 0 ? (
            <EstadoVacio mensaje="Sin archivos en el lote" />
          ) : (
            <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
              {resumen.resultados.map((resultado) => (
                <li key={resultado.archivo} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <span
                    className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      resultado.ok
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                    aria-hidden="true"
                  >
                    {resultado.ok ? '✓' : '✕'}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-slate-200">{resultado.archivo}</span>
                    <span
                      className={`block text-xs ${resultado.ok ? 'text-emerald-300' : 'text-rose-300'}`}
                    >
                      {resultado.ok ? 'Candidato creado' : (resultado.motivo ?? 'Falló')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
