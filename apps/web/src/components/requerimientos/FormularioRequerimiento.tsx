import { useState } from 'react';
import type { FormEvent } from 'react';

import { mensajeDeError, solicitud } from '../../lib/api';
import { textoALista } from '../../lib/formato';
import { useRecurso } from '../../lib/useRecurso';
import { useSesionStore } from '../../store/sesion';
import {
  MODALIDADES_REQUERIMIENTO,
  URGENCIAS_REQUERIMIENTO,
  type Departamento,
  type ModalidadRequerimiento,
  type Requerimiento,
  type RequerimientoNuevo,
  type UrgenciaRequerimiento,
} from '../../tipos';
import { CampoArea, CampoTexto } from '../ui/campos';
import { Spinner } from '../ui/feedback';
import { CLASE_BOTON_PRINCIPAL, CLASE_CAMPO, CLASE_ETIQUETA } from '../ui/estilos';

/** Etiquetas legibles de urgencia (badges y selects). */
export const ETIQUETA_URGENCIA: Readonly<Record<UrgenciaRequerimiento, string>> = {
  normal: 'Normal',
  alta: 'Alta',
  critica: 'Crítica',
};

/** Etiquetas legibles de modalidad. */
export const ETIQUETA_MODALIDAD: Readonly<Record<ModalidadRequerimiento, string>> = {
  directa: 'Directa',
  indirecta: 'Indirecta',
  terceros: 'Terceros / Contratistas',
};

/**
 * Formulario de las 5 secciones del requerimiento, compartido por «Nuevo»
 * (POST) y «Editar» (PATCH con las secciones completas rellenadas).
 *
 * La validación del cliente REFLEJA los mensajes de los DTO de la API
 * (`apps/api/src/modules/requerimientos/dto/create-requerimiento.dto.ts` y
 * `salary-range.validator.ts`): si el backend cambia sus mensajes, hay que
 * cambiarlos aquí. Es una mejora de experiencia, no seguridad: el
 * ValidationPipe vuelve a validar todo en el servidor.
 */

/** Estado del formulario: SIEMPRE strings (los inputs no trabajan con números). */
export interface EstadoFormularioRequerimiento {
  titulo: string;
  jefatura: string;
  numeroPlazas: string;
  urgencia: UrgenciaRequerimiento;
  modalidad: ModalidadRequerimiento;
  departamentoId: string;
  ubicacion: string;
  fechaRequerida: string;
  experienciaRequerida: string;
  nivelEducacion: string;
  perfilProfesional: string;
  conocimientos: string;
  habilidades: string;
  salarioMin: string;
  salarioMax: string;
  tipoContrato: string;
  jornada: string;
  justificacion: string;
}

/** Errores por campo (clave = nombre del campo del formulario). */
export type ErroresFormulario = Partial<Record<keyof EstadoFormularioRequerimiento, string>>;

export function formularioVacio(): EstadoFormularioRequerimiento {
  return {
    titulo: '',
    jefatura: '',
    numeroPlazas: '1',
    urgencia: 'normal',
    modalidad: 'directa',
    departamentoId: '',
    ubicacion: '',
    fechaRequerida: '',
    experienciaRequerida: '',
    nivelEducacion: '',
    perfilProfesional: '',
    conocimientos: '',
    habilidades: '',
    salarioMin: '',
    salarioMax: '',
    tipoContrato: '',
    jornada: '',
    justificacion: '',
  };
}

/** Precarga el formulario desde un requerimiento existente (modo edición). */
export function formularioDesdeRequerimiento(
  requerimiento: Requerimiento,
): EstadoFormularioRequerimiento {
  return {
    titulo: requerimiento.titulo,
    jefatura: requerimiento.jefatura,
    numeroPlazas: String(requerimiento.numeroPlazas),
    urgencia: requerimiento.urgencia,
    modalidad: requerimiento.modalidad,
    departamentoId: requerimiento.departamentoId ?? '',
    ubicacion: requerimiento.ubicacion ?? '',
    fechaRequerida: requerimiento.fechaRequerida ?? '',
    experienciaRequerida: requerimiento.experienciaRequerida ?? '',
    nivelEducacion: requerimiento.nivelEducacion ?? '',
    perfilProfesional: requerimiento.perfilProfesional,
    conocimientos: requerimiento.conocimientos.join(', '),
    habilidades: requerimiento.habilidades.join(', '),
    salarioMin: requerimiento.salarioMin === null ? '' : String(requerimiento.salarioMin),
    salarioMax: requerimiento.salarioMax === null ? '' : String(requerimiento.salarioMax),
    tipoContrato: requerimiento.tipoContrato ?? '',
    jornada: requerimiento.jornada ?? '',
    justificacion: requerimiento.justificacion,
  };
}

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Valida el formulario replicando los mensajes de los DTO del backend. */
export function validarFormularioRequerimiento(
  formulario: EstadoFormularioRequerimiento,
): ErroresFormulario {
  const errores: ErroresFormulario = {};

  if (formulario.titulo.trim().length === 0) errores.titulo = 'titulo es obligatorio';
  if (formulario.jefatura.trim().length === 0) errores.jefatura = 'jefatura es obligatoria';

  const plazas = formulario.numeroPlazas.trim();
  if (!/^\d+$/.test(plazas)) {
    errores.numeroPlazas = 'numeroPlazas debe ser un número entero';
  } else if (Number(plazas) < 1) {
    errores.numeroPlazas = 'numeroPlazas debe ser al menos 1';
  }

  if (formulario.fechaRequerida.trim().length === 0) {
    errores.fechaRequerida = 'fechaRequerida es obligatoria';
  } else if (!PATRON_FECHA.test(formulario.fechaRequerida)) {
    errores.fechaRequerida = 'fechaRequerida debe ser una fecha válida en formato YYYY-MM-DD';
  }

  if (formulario.perfilProfesional.trim().length === 0) {
    errores.perfilProfesional = 'perfilProfesional es obligatorio';
  }
  if (formulario.experienciaRequerida.trim().length === 0) {
    errores.experienciaRequerida = 'experienciaRequerida es obligatoria';
  }
  if (formulario.nivelEducacion.trim().length === 0) {
    errores.nivelEducacion = 'nivelEducacion es obligatorio';
  }

  if (textoALista(formulario.conocimientos).length === 0) {
    errores.conocimientos = 'conocimientos no puede estar vacía';
  }
  if (textoALista(formulario.habilidades).length === 0) {
    errores.habilidades = 'habilidades no puede estar vacía';
  }
  if (formulario.departamentoId.trim().length === 0) {
    errores.departamentoId = 'departamentoId es obligatorio';
  }
  if (formulario.ubicacion.trim().length === 0) {
    errores.ubicacion = 'ubicacion es obligatoria';
  }

  const min = formulario.salarioMin.trim();
  const max = formulario.salarioMax.trim();
  if (min.length === 0) {
    errores.salarioMin = 'salarioMin es obligatorio';
  } else {
    if (Number.isNaN(Number(min))) {
      errores.salarioMin = 'salarioMin debe ser un número';
    } else if (Number(min) < 0) {
      errores.salarioMin = 'salarioMin no puede ser negativo';
    }
  }
  if (max.length === 0) {
    errores.salarioMax = 'salarioMax es obligatorio';
  } else {
    if (Number.isNaN(Number(max))) {
      errores.salarioMax = 'salarioMax debe ser un número';
    } else if (Number(max) < 0) {
      errores.salarioMax = 'salarioMax no puede ser negativo';
    }
  }
  if (
    errores.salarioMin === undefined &&
    errores.salarioMax === undefined &&
    min.length > 0 &&
    max.length > 0 &&
    Number(min) > Number(max)
  ) {
    errores.salarioMax = 'El salario mínimo no puede ser mayor que el salario máximo';
  }
  if (formulario.tipoContrato.trim().length === 0) {
    errores.tipoContrato = 'tipoContrato es obligatorio';
  }
  if (formulario.jornada.trim().length === 0) {
    errores.jornada = 'jornada es obligatoria';
  }

  if (formulario.justificacion.trim().length === 0) {
    errores.justificacion = 'justificacion es obligatoria';
  }

  return errores;
}

/** Convierte el formulario en el cuerpo de las 5 secciones que espera la API. */
export function aCuerpoRequerimiento(
  formulario: EstadoFormularioRequerimiento,
): RequerimientoNuevo {
  const cuerpo: RequerimientoNuevo = {
    identificacion: {
      titulo: formulario.titulo.trim(),
      jefatura: formulario.jefatura.trim(),
      numeroPlazas: Number(formulario.numeroPlazas.trim()),
      urgencia: formulario.urgencia,
      modalidad: formulario.modalidad,
      departamentoId: formulario.departamentoId.trim(),
      ubicacion: formulario.ubicacion.trim(),
      fechaRequerida: formulario.fechaRequerida,
    },
    perfil: {
      perfilProfesional: formulario.perfilProfesional.trim(),
      experienciaRequerida: formulario.experienciaRequerida.trim(),
      nivelEducacion: formulario.nivelEducacion.trim(),
    },
    conocimientos: {
      conocimientos: textoALista(formulario.conocimientos),
      habilidades: textoALista(formulario.habilidades),
    },
    condiciones: {
      salarioMin: Number(formulario.salarioMin.trim()),
      salarioMax: Number(formulario.salarioMax.trim()),
      tipoContrato: formulario.tipoContrato.trim(),
      jornada: formulario.jornada.trim(),
    },
    justificacion: { justificacion: formulario.justificacion.trim() },
  };

  return cuerpo;
}

/**
 * Formulario controlado con validación al enviar.
 *
 * `onGuardar` recibe el cuerpo ya convertido y lanza la petición; cualquier
 * `ApiError` se muestra aquí (mensaje del servidor incluido).
 */
export function FormularioRequerimiento({
  inicial,
  textoGuardar = 'Guardar',
  onGuardar,
}: {
  inicial?: Requerimiento | null;
  textoGuardar?: string;
  onGuardar: (cuerpo: RequerimientoNuevo) => Promise<void>;
}) {
  const usuario = useSesionStore((sesion) => sesion.usuario);
  const esNuevo = inicial === undefined || inicial === null;
  const esLider = usuario?.role === 'lider_area';
  const jefaturaAsignada = esLider ? (usuario.jefatura ?? '') : '';
  const [formulario, setFormulario] = useState<EstadoFormularioRequerimiento>(
    esNuevo
      ? { ...formularioVacio(), jefatura: jefaturaAsignada }
      : formularioDesdeRequerimiento(inicial),
  );
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);

  // El catálogo de departamentos es obligatorio para crear un requerimiento.
  const departamentos = useRecurso<Departamento[]>(
    () => solicitud<Departamento[]>('/departamentos'),
    [],
  );

  const cambiar = (campo: keyof EstadoFormularioRequerimiento) => (valor: string) => {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }));
    setErrores((anteriores) => ({ ...anteriores, [campo]: undefined }));
  };

  const alEnviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const detectados = validarFormularioRequerimiento(formulario);
    setErrores(detectados);
    if (Object.values(detectados).some((error) => error !== undefined)) return;

    setEnviando(true);
    setErrorServidor(null);
    try {
      await onGuardar(aCuerpoRequerimiento(formulario));
    } catch (capturado) {
      setErrorServidor(mensajeDeError(capturado, 'No se pudo guardar el requerimiento'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={alEnviar} className="space-y-4" noValidate>
      <fieldset className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <legend className="px-2 text-sm font-semibold text-slate-200">
          1. Identificación y jefatura
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            etiqueta="Título *"
            valor={formulario.titulo}
            onCambio={cambiar('titulo')}
            error={errores.titulo}
          />
          {esNuevo && (usuario?.role === 'admin_rrhh' || usuario?.role === 'superusuario') ? (
            <div>
              <label htmlFor="req-jefatura" className={CLASE_ETIQUETA}>
                Jefatura *
              </label>
              <select
                id="req-jefatura"
                value={formulario.jefatura}
                onChange={(evento) => cambiar('jefatura')(evento.target.value)}
                className={CLASE_CAMPO}
              >
                <option value="">(selecciona una jefatura)</option>
                {(departamentos.datos ?? []).map((departamento) => (
                  <option key={departamento.id} value={departamento.nombre}>
                    {departamento.nombre}
                  </option>
                ))}
              </select>
              {errores.jefatura && <p className="mt-1 text-xs text-rose-300">{errores.jefatura}</p>}
            </div>
          ) : (
            <div>
              <CampoTexto
                etiqueta="Jefatura *"
                valor={formulario.jefatura}
                onCambio={cambiar('jefatura')}
                error={errores.jefatura}
                disabled={esNuevo && esLider && jefaturaAsignada.length > 0}
              />
              {esNuevo && esLider && jefaturaAsignada.length > 0 && (
                <p className="mt-1 text-xs text-slate-400">
                  Jefatura asignada automáticamente desde tu cuenta.
                </p>
              )}
            </div>
          )}
          <CampoTexto
            etiqueta="Número de plazas *"
            inputMode="numeric"
            valor={formulario.numeroPlazas}
            onCambio={cambiar('numeroPlazas')}
            error={errores.numeroPlazas}
          />
          <div>
            <label htmlFor="req-urgencia" className={CLASE_ETIQUETA}>
              Urgencia
            </label>
            <select
              id="req-urgencia"
              value={formulario.urgencia}
              onChange={(evento) =>
                cambiar('urgencia')(evento.target.value as UrgenciaRequerimiento)
              }
              className={CLASE_CAMPO}
            >
              {URGENCIAS_REQUERIMIENTO.map((urgencia) => (
                <option key={urgencia} value={urgencia}>
                  {ETIQUETA_URGENCIA[urgencia]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="req-modalidad" className={CLASE_ETIQUETA}>
              Modalidad
            </label>
            <select
              id="req-modalidad"
              value={formulario.modalidad}
              onChange={(evento) =>
                cambiar('modalidad')(evento.target.value as ModalidadRequerimiento)
              }
              className={CLASE_CAMPO}
            >
              {MODALIDADES_REQUERIMIENTO.map((modalidad) => (
                <option key={modalidad} value={modalidad}>
                  {ETIQUETA_MODALIDAD[modalidad]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="req-departamento" className={CLASE_ETIQUETA}>
              Departamento *
            </label>
            <select
              id="req-departamento"
              value={formulario.departamentoId}
              onChange={(evento) => cambiar('departamentoId')(evento.target.value)}
              className={CLASE_CAMPO}
            >
              <option value="">(selecciona un departamento)</option>
              {(departamentos.datos ?? []).map((departamento) => (
                <option key={departamento.id} value={departamento.id}>
                  {departamento.nombre}
                </option>
              ))}
            </select>
            {errores.departamentoId && (
              <p className="mt-1 text-xs text-rose-300">{errores.departamentoId}</p>
            )}
          </div>
          <CampoTexto
            etiqueta="Ubicación *"
            valor={formulario.ubicacion}
            onCambio={cambiar('ubicacion')}
            error={errores.ubicacion}
          />
          <CampoTexto
            etiqueta="Fecha requerida *"
            type="date"
            valor={formulario.fechaRequerida}
            onCambio={cambiar('fechaRequerida')}
            error={errores.fechaRequerida}
          />
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <legend className="px-2 text-sm font-semibold text-slate-200">2. Perfil profesional</legend>
        <div className="grid gap-4">
          <CampoArea
            etiqueta="Perfil profesional *"
            rows={3}
            valor={formulario.perfilProfesional}
            onCambio={cambiar('perfilProfesional')}
            error={errores.perfilProfesional}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              etiqueta="Experiencia requerida *"
              valor={formulario.experienciaRequerida}
              onCambio={cambiar('experienciaRequerida')}
              error={errores.experienciaRequerida}
            />
            <CampoTexto
              etiqueta="Nivel de educación *"
              valor={formulario.nivelEducacion}
              onCambio={cambiar('nivelEducacion')}
              error={errores.nivelEducacion}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <legend className="px-2 text-sm font-semibold text-slate-200">
          3. Conocimientos y habilidades
        </legend>
        <div className="grid gap-4">
          <CampoArea
            etiqueta="Conocimientos (separados por comas) *"
            rows={2}
            placeholder="SQL, Excel, normativa laboral"
            valor={formulario.conocimientos}
            onCambio={cambiar('conocimientos')}
            error={errores.conocimientos}
          />
          <CampoArea
            etiqueta="Habilidades (separadas por comas) *"
            rows={2}
            placeholder="Comunicación, análisis, trabajo en equipo"
            valor={formulario.habilidades}
            onCambio={cambiar('habilidades')}
            error={errores.habilidades}
          />
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <legend className="px-2 text-sm font-semibold text-slate-200">
          4. Condiciones salariales y contractuales
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            etiqueta="Salario mínimo *"
            inputMode="decimal"
            valor={formulario.salarioMin}
            onCambio={cambiar('salarioMin')}
            error={errores.salarioMin}
          />
          <CampoTexto
            etiqueta="Salario máximo *"
            inputMode="decimal"
            valor={formulario.salarioMax}
            onCambio={cambiar('salarioMax')}
            error={errores.salarioMax}
          />
          <CampoTexto
            etiqueta="Tipo de contrato *"
            valor={formulario.tipoContrato}
            onCambio={cambiar('tipoContrato')}
            error={errores.tipoContrato}
          />
          <CampoTexto
            etiqueta="Jornada *"
            valor={formulario.jornada}
            onCambio={cambiar('jornada')}
            error={errores.jornada}
          />
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <legend className="px-2 text-sm font-semibold text-slate-200">5. Justificación</legend>
        <CampoArea
          etiqueta="Justificación *"
          rows={3}
          valor={formulario.justificacion}
          onCambio={cambiar('justificacion')}
          error={errores.justificacion}
        />
      </fieldset>

      {errorServidor && (
        <p
          role="alert"
          className="rounded-lg border border-rose-700/60 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
        >
          {errorServidor}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={enviando} className={CLASE_BOTON_PRINCIPAL}>
          {enviando ? 'Guardando…' : textoGuardar}
        </button>
        {enviando && <Spinner texto="Guardando cambios…" />}
      </div>
    </form>
  );
}
