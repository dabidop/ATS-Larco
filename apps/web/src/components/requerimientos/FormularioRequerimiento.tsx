import { useState } from 'react';
import type { FormEvent } from 'react';

import { mensajeDeError } from '../../lib/api';
import { textoALista } from '../../lib/formato';
import type { Requerimiento, RequerimientoNuevo } from '../../tipos';
import { CampoArea, CampoTexto } from '../ui/campos';
import { Spinner } from '../ui/feedback';
import { CLASE_BOTON_PRINCIPAL } from '../ui/estilos';

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

  if (formulario.fechaRequerida.length > 0 && !PATRON_FECHA.test(formulario.fechaRequerida)) {
    errores.fechaRequerida = 'fechaRequerida debe ser una fecha válida en formato YYYY-MM-DD';
  }

  if (formulario.perfilProfesional.trim().length === 0) {
    errores.perfilProfesional = 'perfilProfesional es obligatorio';
  }

  if (textoALista(formulario.conocimientos).length === 0) {
    errores.conocimientos = 'conocimientos no puede estar vacía';
  }
  if (textoALista(formulario.habilidades).length === 0) {
    errores.habilidades = 'habilidades no puede estar vacía';
  }

  const min = formulario.salarioMin.trim();
  const max = formulario.salarioMax.trim();
  if (min.length > 0) {
    if (Number.isNaN(Number(min))) {
      errores.salarioMin = 'salarioMin debe ser un número';
    } else if (Number(min) < 0) {
      errores.salarioMin = 'salarioMin no puede ser negativo';
    }
  }
  if (max.length > 0) {
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
    },
    perfil: { perfilProfesional: formulario.perfilProfesional.trim() },
    conocimientos: {
      conocimientos: textoALista(formulario.conocimientos),
      habilidades: textoALista(formulario.habilidades),
    },
    condiciones: {},
    justificacion: { justificacion: formulario.justificacion.trim() },
  };

  const ubicacion = formulario.ubicacion.trim();
  if (ubicacion.length > 0) cuerpo.identificacion.ubicacion = ubicacion;
  if (formulario.fechaRequerida.length > 0) {
    cuerpo.identificacion.fechaRequerida = formulario.fechaRequerida;
  }

  const experiencia = formulario.experienciaRequerida.trim();
  if (experiencia.length > 0) cuerpo.perfil.experienciaRequerida = experiencia;
  const educacion = formulario.nivelEducacion.trim();
  if (educacion.length > 0) cuerpo.perfil.nivelEducacion = educacion;

  const min = formulario.salarioMin.trim();
  if (min.length > 0) cuerpo.condiciones.salarioMin = Number(min);
  const max = formulario.salarioMax.trim();
  if (max.length > 0) cuerpo.condiciones.salarioMax = Number(max);
  const tipoContrato = formulario.tipoContrato.trim();
  if (tipoContrato.length > 0) cuerpo.condiciones.tipoContrato = tipoContrato;
  const jornada = formulario.jornada.trim();
  if (jornada.length > 0) cuerpo.condiciones.jornada = jornada;

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
  const [formulario, setFormulario] = useState<EstadoFormularioRequerimiento>(
    inicial === undefined || inicial === null
      ? formularioVacio()
      : formularioDesdeRequerimiento(inicial),
  );
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);

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
          <CampoTexto
            etiqueta="Jefatura *"
            valor={formulario.jefatura}
            onCambio={cambiar('jefatura')}
            error={errores.jefatura}
          />
          <CampoTexto
            etiqueta="Número de plazas *"
            inputMode="numeric"
            valor={formulario.numeroPlazas}
            onCambio={cambiar('numeroPlazas')}
            error={errores.numeroPlazas}
          />
          <CampoTexto
            etiqueta="Ubicación"
            valor={formulario.ubicacion}
            onCambio={cambiar('ubicacion')}
            error={errores.ubicacion}
          />
          <CampoTexto
            etiqueta="Fecha requerida"
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
              etiqueta="Experiencia requerida"
              valor={formulario.experienciaRequerida}
              onCambio={cambiar('experienciaRequerida')}
              error={errores.experienciaRequerida}
            />
            <CampoTexto
              etiqueta="Nivel de educación"
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
            etiqueta="Salario mínimo"
            inputMode="decimal"
            valor={formulario.salarioMin}
            onCambio={cambiar('salarioMin')}
            error={errores.salarioMin}
          />
          <CampoTexto
            etiqueta="Salario máximo"
            inputMode="decimal"
            valor={formulario.salarioMax}
            onCambio={cambiar('salarioMax')}
            error={errores.salarioMax}
          />
          <CampoTexto
            etiqueta="Tipo de contrato"
            valor={formulario.tipoContrato}
            onCambio={cambiar('tipoContrato')}
            error={errores.tipoContrato}
          />
          <CampoTexto
            etiqueta="Jornada"
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
