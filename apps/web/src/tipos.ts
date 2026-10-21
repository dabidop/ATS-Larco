/**
 * Tipos compartidos por toda la SPA.
 *
 * Cada interfaz replica la forma EXACTA de las respuestas de la API, leída de
 * los DTO de `apps/api/src/modules/<módulo>/dto` (son la fuente de verdad; si la API
 * cambia, cambia este fichero). Los identificadores de código van en inglés y
 * los textos visibles en español, según la convención del monorepo.
 */

/** Códigos de rol admitidos por el RBAC (`roles.code` en BD). */
export type Rol = 'admin_rrhh' | 'analista_seleccion' | 'lider_area';

/**
 * Estados del ciclo de vida de un requerimiento.
 * Orden del ENUM `estado_requerimiento` (migración 003 de la API).
 */
export type EstadoRequerimiento = 'pendiente' | 'aprobado' | 'en_proceso' | 'cerrado' | 'rechazado';

/** Los 5 estados en el orden del ENUM, para poblar selects y filtros. */
export const ESTADOS_REQUERIMIENTO: readonly EstadoRequerimiento[] = [
  'pendiente',
  'aprobado',
  'en_proceso',
  'cerrado',
  'rechazado',
];

/** Usuario de la sesión tal y como lo entrega `POST /api/auth/login`. */
export interface UsuarioSesion {
  /** `users.id` (uuid): hace falta para comparar con `createdBy`. */
  id: string;
  email: string;
  fullName: string;
  /** Puede ser un rol fuera de la matriz; los predicados lo tratan con cuidado. */
  role: string;
}

/** Respuesta de `POST /api/auth/login` y `POST /api/auth/refresh`. */
export interface RespuestaLogin {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: UsuarioSesion;
}

/** Respuesta paginada de `GET /api/requerimientos` y `GET /api/candidatos`. */
export interface Pagina<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// ────────────────────────────── Requerimientos ──────────────────────────────

/** `GET /api/requerimientos/:id` (`RequerimientoResponseDto`). */
export interface Requerimiento {
  id: string;
  code: string;
  estado: EstadoRequerimiento;
  createdBy: string;
  // 1 — identificación
  titulo: string;
  jefatura: string;
  numeroPlazas: number;
  ubicacion: string | null;
  fechaRequerida: string | null;
  // 2 — perfil
  experienciaRequerida: string | null;
  nivelEducacion: string | null;
  perfilProfesional: string;
  // 3 — conocimientos y habilidades
  conocimientos: string[];
  habilidades: string[];
  // 4 — condiciones
  salarioMin: number | null;
  salarioMax: number | null;
  tipoContrato: string | null;
  jornada: string | null;
  // 5 — justificación
  justificacion: string;
  motivoRechazo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Sección 1 del cuerpo de `POST/PATCH /api/requerimientos`. */
export interface SeccionIdentificacion {
  titulo: string;
  jefatura: string;
  numeroPlazas: number;
  ubicacion?: string;
  /** `'YYYY-MM-DD'` exacto (`@IsDateString({ strictSeparator: true })`). */
  fechaRequerida?: string;
}

/** Sección 2. */
export interface SeccionPerfil {
  experienciaRequerida?: string;
  nivelEducacion?: string;
  perfilProfesional: string;
}

/** Sección 3: arrays `text[]` no vacíos. */
export interface SeccionConocimientos {
  conocimientos: string[];
  habilidades: string[];
}

/** Sección 4: todo opcional (la BD admite nulos). */
export interface SeccionCondiciones {
  salarioMin?: number;
  salarioMax?: number;
  tipoContrato?: string;
  jornada?: string;
}

/** Sección 5. */
export interface SeccionJustificacion {
  justificacion: string;
}

/**
 * Cuerpo de `POST /api/requerimientos` (5 secciones anidadas obligatorias) y
 * de `PATCH /api/requerimientos/:id` (el DTO de actualización admite también
 * secciones parciales; el formulario siempre envía las secciones completas).
 */
export interface RequerimientoNuevo {
  identificacion: SeccionIdentificacion;
  perfil: SeccionPerfil;
  conocimientos: SeccionConocimientos;
  condiciones: SeccionCondiciones;
  justificacion: SeccionJustificacion;
}

/** Destinos alcanzables por `POST /api/requerimientos/:id/transiciones`. */
export type DestinoTransicion = Exclude<EstadoRequerimiento, 'pendiente'>;

// ──────────────────────────────── Candidatos ────────────────────────────────

/** `GET /api/candidatos/:id` (`CandidatoResponseDto`): la PII sale DESCIFRADA. */
export interface Candidato {
  id: string;
  nombres: string;
  apellidos: string;
  email: string | null;
  cedula: string;
  telefono: string | null;
  ciudad: string | null;
  cargoActual: string | null;
  expectativaSalarial: number | null;
  disponibilidad: string | null;
  notas: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Cuerpo de `POST /api/candidatos` (nombres, apellidos y cédula obligatorios). */
export interface CandidatoNuevo {
  nombres: string;
  apellidos: string;
  cedula: string;
  email?: string;
  telefono?: string;
  ciudad?: string;
  cargoActual?: string;
  expectativaSalarial?: number;
}

/** Cuerpo de `PATCH /api/candidatos/:id`: todo opcional. */
export type CandidatoActualizacion = Partial<CandidatoNuevo>;

/** Metadatos de un CV (`ArchivoCvResponseDto`). */
export interface ArchivoCv {
  id: string;
  filenameOriginal: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  candidatoId: string;
  createdAt: string;
}

/** Un campo concreto del historial (`CambioHistorialDto`). La PII llega `***`. */
export interface CambioHistorial {
  campo: string;
  antes: unknown;
  despues: unknown;
}

/** Entrada de `GET /api/candidatos/:id/historial` (`EntradaHistorialDto`). */
export interface EntradaHistorial {
  id: string;
  accion: 'INSERT' | 'UPDATE' | 'DELETE';
  fecha: string;
  usuario: string | null;
  usuarioEmail: string | null;
  campos: CambioHistorial[];
}
