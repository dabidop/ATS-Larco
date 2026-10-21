import { vi } from 'vitest';

import { CLAVE_SESION, useSesionStore } from '../store/sesion';
import type {
  ArchivoCv,
  Candidato,
  EntradaHistorial,
  EntradaHistorialPostulacion,
  Pagina,
  Postulacion,
  Requerimiento,
  RespuestaLogin,
  UsuarioSesion,
} from '../tipos';

/**
 * Auxiliares de los tests de la SPA.
 *
 * REGLA DE ORO: en los tests NUNCA hay red real; `instalarFetch` sustituye el
 * `fetch` global por un manejador de rutas que devuelve cuerpos de mentira.
 */

export interface RespuestaMock {
  /** Status HTTP (por defecto 200). */
  status?: number;
  /** Cuerpo JSON de la respuesta. */
  cuerpo?: unknown;
  /** Binario para `descargar()` (pruebas de descarga de CV). */
  blob?: Blob;
}

export type ManejadorFetch = (url: string, init?: RequestInit) => RespuestaMock | undefined;

/**
 * Instala un `fetch` falso. Devuelve el `vi.fn()` para poder inspeccionar
 * llamadas (URL, método, headers…). Una petición no preparada lanza un error
 * visible: así un test nunca depende accidentalmente de la API real.
 */
export function instalarFetch(manejador: ManejadorFetch) {
  const mock = vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada.toString();
    const respuesta = manejador(url, init);
    if (respuesta === undefined) {
      throw new Error(`Petición no preparada en el test: ${url}`);
    }
    const status = respuesta.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (respuesta.cuerpo ?? null) as unknown,
      blob: async () => respuesta.blob ?? new Blob(),
      headers: new Headers(),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Sembrar el store de sesión como si el usuario ya hubiera iniciado sesión. */
export function sembrarSesion(role: string, id = 'usuario-de-prueba'): UsuarioSesion {
  const usuario: UsuarioSesion = {
    id,
    email: 'usuario@larco.test',
    fullName: 'Usuario de Prueba',
    role,
  };
  useSesionStore.setState({ token: 'token-de-prueba', usuario });
  localStorage.setItem(CLAVE_SESION, JSON.stringify({ token: 'token-de-prueba', usuario }));
  return usuario;
}

/** Deja la aplicación «desconectada» (sin sesión en memoria ni persistida). */
export function limpiarSesion(): void {
  useSesionStore.setState({ token: null, usuario: null });
  localStorage.removeItem(CLAVE_SESION);
}

/** Respuesta válida de `POST /api/auth/login`. */
export function fixtureLogin(extra: Partial<RespuestaLogin> = {}): RespuestaLogin {
  return {
    accessToken: 'jwt-de-prueba',
    tokenType: 'Bearer',
    expiresIn: 86400,
    user: {
      id: 'usuario-de-prueba',
      email: 'usuario@larco.test',
      fullName: 'Usuario de Prueba',
      role: 'admin_rrhh',
    },
    ...extra,
  };
}

/** Requerimiento de mentira con todos los campos del DTO de respuesta. */
export function fixtureRequerimiento(extra: Partial<Requerimiento> = {}): Requerimiento {
  return {
    id: 'req-1',
    code: 'REQ-2026-001',
    estado: 'pendiente',
    createdBy: 'usuario-de-prueba',
    titulo: 'Analista de Selección',
    jefatura: 'Gestión Humana',
    numeroPlazas: 1,
    ubicacion: 'Maracay',
    fechaRequerida: '2026-03-01',
    experienciaRequerida: '2 años',
    nivelEducacion: 'Universitario',
    perfilProfesional: 'Profesional de recursos humanos con foco en selección.',
    conocimientos: ['Entrevistas', 'PSU'],
    habilidades: ['Comunicación', 'Organización'],
    salarioMin: 800,
    salarioMax: 1200,
    tipoContrato: 'Indefinido',
    jornada: 'Completa',
    justificacion: 'Cobertura de vacante aprobada por la jefatura.',
    motivoRechazo: null,
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    ...extra,
  };
}

/** Candidato de mentira con la forma de `CandidatoResponseDto`. */
export function fixtureCandidato(extra: Partial<Candidato> = {}): Candidato {
  return {
    id: 'can-1',
    nombres: 'María',
    apellidos: 'Pérez',
    email: 'maria@example.com',
    cedula: '20123456',
    telefono: '04121234567',
    ciudad: 'Maracay',
    cargoActual: 'Reclutadora',
    expectativaSalarial: 1000,
    disponibilidad: 'Inmediata',
    notas: null,
    createdBy: 'usuario-de-prueba',
    createdAt: '2026-02-01T09:00:00.000Z',
    updatedAt: '2026-02-01T09:00:00.000Z',
    ...extra,
  };
}

/** Metadatos de un CV de mentira (`ArchivoCvResponseDto`). */
export function fixtureArchivoCv(extra: Partial<ArchivoCv> = {}): ArchivoCv {
  return {
    id: 'arc-1',
    filenameOriginal: 'cv-maria.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 20480,
    sha256: 'abc123',
    candidatoId: 'can-1',
    createdAt: '2026-02-02T12:00:00.000Z',
    ...extra,
  };
}

/** Entrada de historial (`EntradaHistorialDto`); la PII llega como `***`. */
export function fixtureHistorial(extra: Partial<EntradaHistorial> = {}): EntradaHistorial {
  return {
    id: '9',
    accion: 'UPDATE',
    fecha: '2026-02-03T15:30:00.000Z',
    usuario: 'usuario-de-prueba',
    usuarioEmail: 'ana@larco.test',
    campos: [{ campo: 'ciudad', antes: 'Maracay', despues: 'Valencia' }],
    ...extra,
  };
}

/** Respuesta paginada de mentira. */
export function fixturePagina<T>(items: T[], extra: Partial<Pagina<T>> = {}): Pagina<T> {
  return { items, total: items.length, page: 1, limit: 10, ...extra };
}

/** Postulación de mentira con la forma de `PostulacionResponseDto`. */
export function fixturePostulacion(extra: Partial<Postulacion> = {}): Postulacion {
  return {
    id: 'pos-1',
    candidatoId: 'can-1',
    candidato: { id: 'can-1', nombres: 'María', apellidos: 'Pérez' },
    requerimientoId: 'req-1',
    fase: 'preseleccion',
    estado: 'activa',
    motivoDescarte: null,
    createdBy: 'usuario-de-prueba',
    createdAt: '2026-02-10T09:00:00.000Z',
    updatedAt: '2026-02-10T09:00:00.000Z',
    ...extra,
  };
}

/** Entrada del historial de una postulación (`EntradaHistorialPostulacionDto`). */
export function fixtureHistorialPostulacion(
  extra: Partial<EntradaHistorialPostulacion> = {},
): EntradaHistorialPostulacion {
  return {
    id: '1',
    accion: 'UPDATE',
    fecha: '2026-02-12T15:30:00.000Z',
    usuario: 'usuario-de-prueba',
    usuarioEmail: 'ana@larco.test',
    campos: [{ campo: 'fase', antes: 'preseleccion', despues: 'antecedentes' }],
    ...extra,
  };
}
