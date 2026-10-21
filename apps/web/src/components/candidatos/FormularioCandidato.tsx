import { useState } from 'react';
import type { FormEvent } from 'react';

import { mensajeDeError } from '../../lib/api';
import type { Candidato, CandidatoNuevo } from '../../tipos';
import { CampoTexto } from '../ui/campos';
import { Spinner } from '../ui/feedback';
import { CLASE_BOTON_PRINCIPAL } from '../ui/estilos';

/**
 * Formulario de datos del candidato, compartido por «Nuevo» (POST) y «Editar»
 * (PATCH). La validación replica los mensajes de
 * `apps/api/src/modules/candidatos/dto/create-candidato.dto.ts`.
 */

/** Formato de cédula del backend: `CEDULA_PATTERN` = de 6 a 10 dígitos. */
export const PATRON_CEDULA = /^\d{6,10}$/;

/** Mensaje del DTO para una cédula inválida (se reutiliza en el listado). */
export const MENSAJE_CEDULA =
  'cedula debe ser una cédula válida: de 6 a 10 dígitos, sin puntos ni guiones';

export interface EstadoFormularioCandidato {
  nombres: string;
  apellidos: string;
  cedula: string;
  email: string;
  telefono: string;
  ciudad: string;
  cargoActual: string;
  expectativaSalarial: string;
}

export type ErroresCandidato = Partial<Record<keyof EstadoFormularioCandidato, string>>;

export function formularioCandidatoVacio(): EstadoFormularioCandidato {
  return {
    nombres: '',
    apellidos: '',
    cedula: '',
    email: '',
    telefono: '',
    ciudad: '',
    cargoActual: '',
    expectativaSalarial: '',
  };
}

/** Precarga desde un candidato existente (la API devuelve PII descifrada). */
export function formularioDesdeCandidato(candidato: Candidato): EstadoFormularioCandidato {
  return {
    nombres: candidato.nombres,
    apellidos: candidato.apellidos,
    cedula: candidato.cedula,
    email: candidato.email ?? '',
    telefono: candidato.telefono ?? '',
    ciudad: candidato.ciudad ?? '',
    cargoActual: candidato.cargoActual ?? '',
    expectativaSalarial:
      candidato.expectativaSalarial === null ? '' : String(candidato.expectativaSalarial),
  };
}

const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida el formulario con los MISMOS mensajes que el DTO del backend. */
export function validarFormularioCandidato(
  formulario: EstadoFormularioCandidato,
): ErroresCandidato {
  const errores: ErroresCandidato = {};

  if (formulario.nombres.trim().length === 0) errores.nombres = 'nombres es obligatorio';
  if (formulario.apellidos.trim().length === 0) errores.apellidos = 'apellidos es obligatorio';
  if (!PATRON_CEDULA.test(formulario.cedula.trim())) errores.cedula = MENSAJE_CEDULA;

  const email = formulario.email.trim();
  if (email.length > 0 && !PATRON_EMAIL.test(email)) {
    errores.email = 'email debe ser un correo electrónico válido';
  }

  const expectativa = formulario.expectativaSalarial.trim();
  if (expectativa.length > 0) {
    if (Number.isNaN(Number(expectativa))) {
      errores.expectativaSalarial = 'expectativaSalarial debe ser un número';
    } else if (Number(expectativa) < 0) {
      errores.expectativaSalarial = 'expectativaSalarial no puede ser negativo';
    }
  }

  return errores;
}

/** Convierte el formulario en el cuerpo que espera `POST/PATCH /candidatos`. */
export function aCuerpoCandidato(formulario: EstadoFormularioCandidato): CandidatoNuevo {
  const cuerpo: CandidatoNuevo = {
    nombres: formulario.nombres.trim(),
    apellidos: formulario.apellidos.trim(),
    cedula: formulario.cedula.trim(),
  };

  const email = formulario.email.trim();
  if (email.length > 0) cuerpo.email = email;
  const telefono = formulario.telefono.trim();
  if (telefono.length > 0) cuerpo.telefono = telefono;
  const ciudad = formulario.ciudad.trim();
  if (ciudad.length > 0) cuerpo.ciudad = ciudad;
  const cargoActual = formulario.cargoActual.trim();
  if (cargoActual.length > 0) cuerpo.cargoActual = cargoActual;
  const expectativa = formulario.expectativaSalarial.trim();
  if (expectativa.length > 0) cuerpo.expectativaSalarial = Number(expectativa);

  return cuerpo;
}

/** Formulario controlado con validación al enviar y errores del servidor. */
export function FormularioCandidato({
  inicial,
  textoGuardar = 'Guardar',
  onGuardar,
}: {
  inicial?: Candidato | null;
  textoGuardar?: string;
  onGuardar: (cuerpo: CandidatoNuevo) => Promise<void>;
}) {
  const [formulario, setFormulario] = useState<EstadoFormularioCandidato>(
    inicial === undefined || inicial === null
      ? formularioCandidatoVacio()
      : formularioDesdeCandidato(inicial),
  );
  const [errores, setErrores] = useState<ErroresCandidato>({});
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);

  const cambiar = (campo: keyof EstadoFormularioCandidato) => (valor: string) => {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }));
    setErrores((anteriores) => ({ ...anteriores, [campo]: undefined }));
  };

  const alEnviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const detectados = validarFormularioCandidato(formulario);
    setErrores(detectados);
    if (Object.values(detectados).some((error) => error !== undefined)) return;

    setEnviando(true);
    setErrorServidor(null);
    try {
      await onGuardar(aCuerpoCandidato(formulario));
    } catch (capturado) {
      setErrorServidor(mensajeDeError(capturado, 'No se pudo guardar el candidato'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={alEnviar} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto
          etiqueta="Nombres *"
          valor={formulario.nombres}
          onCambio={cambiar('nombres')}
          error={errores.nombres}
        />
        <CampoTexto
          etiqueta="Apellidos *"
          valor={formulario.apellidos}
          onCambio={cambiar('apellidos')}
          error={errores.apellidos}
        />
        <CampoTexto
          etiqueta="Cédula * (6 a 10 dígitos)"
          inputMode="numeric"
          valor={formulario.cedula}
          onCambio={cambiar('cedula')}
          error={errores.cedula}
        />
        <CampoTexto
          etiqueta="Email"
          type="email"
          valor={formulario.email}
          onCambio={cambiar('email')}
          error={errores.email}
        />
        <CampoTexto
          etiqueta="Teléfono"
          valor={formulario.telefono}
          onCambio={cambiar('telefono')}
          error={errores.telefono}
        />
        <CampoTexto
          etiqueta="Ciudad"
          valor={formulario.ciudad}
          onCambio={cambiar('ciudad')}
          error={errores.ciudad}
        />
        <CampoTexto
          etiqueta="Cargo actual"
          valor={formulario.cargoActual}
          onCambio={cambiar('cargoActual')}
          error={errores.cargoActual}
        />
        <CampoTexto
          etiqueta="Expectativa salarial"
          inputMode="decimal"
          valor={formulario.expectativaSalarial}
          onCambio={cambiar('expectativaSalarial')}
          error={errores.expectativaSalarial}
        />
      </div>

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
