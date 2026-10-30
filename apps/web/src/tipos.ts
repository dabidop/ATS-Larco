/**
 * Tipos compartidos por toda la SPA.
 *
 * Cada interfaz replica la forma EXACTA de las respuestas de la API, leída de
 * los DTO de `apps/api/src/modules/<módulo>/dto` (son la fuente de verdad; si la API
 * cambia, cambia este fichero). Los identificadores de código van en inglés y
 * los textos visibles en español, según la convención del monorepo.
 */

/** Códigos de rol admitidos por el RBAC (`roles.code` en BD, migración 008). */
export type Rol = 'admin_rrhh' | 'analista_seleccion' | 'lider_area' | 'superusuario';

/**
 * Estados del ciclo de vida de un requerimiento.
 * Orden del ENUM `estado_requerimiento` (migración 003 de la API + `exitoso`
 * de la migración 009, Etapa 9: terminal SOLO automático al cubrir plazas).
 */
export type EstadoRequerimiento =
  'pendiente' | 'aprobado' | 'en_proceso' | 'cerrado' | 'rechazado' | 'exitoso';

/** Los 6 estados en el orden del ENUM, para poblar selects y filtros. */
export const ESTADOS_REQUERIMIENTO: readonly EstadoRequerimiento[] = [
  'pendiente',
  'aprobado',
  'en_proceso',
  'cerrado',
  'rechazado',
  'exitoso',
];

/** Usuario de la sesión tal y como lo entrega `POST /api/auth/login`. */
export interface UsuarioSesion {
  /** `users.id` (uuid): hace falta para comparar con `createdBy`. */
  id: string;
  email: string;
  fullName: string;
  /** Puede ser un rol fuera de la matriz; los predicados lo tratan con cuidado. */
  role: string;
  /** Jefatura asignada al líder de área; null para cuentas sin asignación. */
  jefatura?: string | null;
}

/** Respuesta de `POST /api/auth/login` y `POST /api/auth/refresh`. */
export interface RespuestaLogin {
  /** Solo existe en respuestas de compatibilidad; el navegador usa cookie HttpOnly. */
  accessToken?: string;
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
  /** Prioridad (Etapa 9): `normal` | `alta` | `critica`. */
  urgencia: UrgenciaRequerimiento;
  /** Modalidad (Etapa 9): `directa` | `indirecta` | `terceros`. */
  modalidad: ModalidadRequerimiento;
  /** FK al área LARCO (`departamentos`); `null` si no está asociado. */
  departamentoId: string | null;
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
  /** Poblado solo con `estado = 'cerrado'` (obligatorio, CHECK en BD). */
  motivoCierre: string | null;
  /** `contratacion` | `cierre_vacante`; solo informado al cerrar. */
  resultadoCierre: ResultadoCierre | null;
  createdAt: string;
  updatedAt: string;
}

/** Sección 1 del cuerpo de `POST/PATCH /api/requerimientos`. */
export interface SeccionIdentificacion {
  titulo: string;
  jefatura: string;
  numeroPlazas: number;
  urgencia: UrgenciaRequerimiento;
  modalidad: ModalidadRequerimiento;
  departamentoId: string;
  ubicacion: string;
  /** `'YYYY-MM-DD'` exacto (`@IsDateString({ strictSeparator: true })`. */
  fechaRequerida: string;
}

/** Sección 2. */
export interface SeccionPerfil {
  experienciaRequerida: string;
  nivelEducacion: string;
  perfilProfesional: string;
}

/** Sección 3: arrays `text[]` no vacíos. */
export interface SeccionConocimientos {
  conocimientos: string[];
  habilidades: string[];
}

/** Sección 4: todos los campos son obligatorios. */
export interface SeccionCondiciones {
  salarioMin: number;
  salarioMax: number;
  tipoContrato: string;
  jornada: string;
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

/**
 * Destinos alcanzables por `POST /api/requerimientos/:id/transiciones`:
 * `pendiente` es siempre el punto de partida y `exitoso` es un estado SOLO
 * AUTOMÁTICO (lo pone el servidor al cubrir las plazas; el cliente no puede
 * pedirlo), por eso ninguno de los dos aparece aquí.
 */
export type DestinoTransicion = 'aprobado' | 'rechazado' | 'en_proceso' | 'cerrado';

/** Resultado del cierre (Etapa 9, `resultado_cierre`): ¿se contrató a alguien? */
export type ResultadoCierre = 'contratacion' | 'cierre_vacante';

/** Los 2 resultados, en orden, para poblar el select de cierre. */
export const RESULTADOS_CIERRE: readonly ResultadoCierre[] = ['contratacion', 'cierre_vacante'];

/** Urgencia del requerimiento (`urgencia_requerimiento`, migración 009). */
export type UrgenciaRequerimiento = 'normal' | 'alta' | 'critica';

/** Las 3 urgencias, en orden, para poblar selects. */
export const URGENCIAS_REQUERIMIENTO: readonly UrgenciaRequerimiento[] = [
  'normal',
  'alta',
  'critica',
];

/** Modalidad de contratación (`modalidad_requerimiento`, migración 009). */
export type ModalidadRequerimiento = 'directa' | 'indirecta' | 'terceros';

/** Las 3 modalidades, en orden, para poblar selects. */
export const MODALIDADES_REQUERIMIENTO: readonly ModalidadRequerimiento[] = [
  'directa',
  'indirecta',
  'terceros',
];

// ──────────────────────────────── Candidatos ────────────────────────────────

/** `GET /api/candidatos/:id` (`CandidatoResponseDto`): la PII sale DESCIFRADA. */
export interface Candidato {
  id: string;
  nombres: string;
  apellidos: string;
  email: string | null;
  /** `''` si el candidato fue IMPORTADO sin cédula (migración 010). */
  cedula: string;
  telefono: string | null;
  ciudad: string | null;
  /** FK al área LARCO (`departamentos`); `null` si no está asociado. */
  departamentoId: string | null;
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
  /** Área LARCO (Etapa 9, opcional). */
  departamentoId?: string;
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

// ───────────────────────── Embudo de selección (postulaciones) ─────────────────────────

/**
 * Las 5 fases del embudo, EN ORDEN de avance (columnas del tablero Kanban).
 * Espejo del ENUM `fase_postulacion` (migración 007 de la API) y de
 * `apps/api/src/modules/embudo/postulaciones-fases.ts`.
 */
export const FASES_POSTULACION = [
  'preseleccion',
  'antecedentes',
  'entrevistas',
  'proveedor_externo',
  'contratacion',
] as const;

/** Una de las 5 fases del embudo. */
export type FasePostulacion = (typeof FASES_POSTULACION)[number];

/** Estados del ENUM `estado_postulacion`: 1 activa + 2 terminales. */
export type EstadoPostulacion = 'activa' | 'contratado' | 'descartado';

/** Resumen PÚBLICO del candidato que viaja en cada postulación (sin PII). */
export interface CandidatoResumen {
  id: string;
  nombres: string;
  apellidos: string;
}

/** `GET /api/postulaciones` (item) y respuestas de POST/PATCH (`PostulacionResponseDto`). */
export interface Postulacion {
  id: string;
  candidatoId: string;
  candidato: CandidatoResumen;
  requerimientoId: string;
  fase: FasePostulacion;
  estado: EstadoPostulacion;
  motivoDescarte: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Un campo concreto del historial de una postulación (`CambioHistorialDto`). */
export interface CambioHistorialPostulacion {
  campo: 'fase' | 'estado' | 'motivoDescarte';
  antes: unknown;
  despues: unknown;
}

/** Entrada de `GET /api/postulaciones/:id/historial` (máx. 200, DESC). */
export interface EntradaHistorialPostulacion {
  id: string;
  accion: 'INSERT' | 'UPDATE' | 'DELETE';
  fecha: string;
  usuario: string | null;
  usuarioEmail: string | null;
  campos: CambioHistorialPostulacion[];
}

// ─────────────────────── Usuarios (gestión de cuentas, Etapa 8B) ───────────────────────

/**
 * Usuario tal y como lo devuelve `/api/usuarios` (`UsuarioResponseDto`).
 * La API NUNCA devuelve la contraseña (ni el hash): la forma pública está
 * fijada en `apps/api/src/modules/usuarios/dto/usuario.response.ts`.
 */
export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  /** Código del rol (`roles.code`), fuente de verdad del RBAC. */
  rol: string;
  /** Nombre legible del rol (`roles.name`) para pintar la tabla. */
  rolNombre: string;
  activo: boolean;
  /**
   * Jefatura/área del `lider_area` (corrección posterior a la Etapa 9): con
   * ella el líder solo ve lo de SU área. `null` si no tiene asignada.
   */
  jefatura: string | null;
  /** ISO 8601 (UTC). */
  creadoEn: string;
}

/** Cuerpo de `POST /api/usuarios` (contraseña mínima de 8 caracteres). */
export interface UsuarioNuevo {
  nombre: string;
  email: string;
  password: string;
  rol: string;
  /** Jefatura del líder; opcional (y sin efecto en roles que no son líder). */
  jefatura?: string | null;
}

/**
 * Cuerpo de `PATCH /api/usuarios/:id`: parcial, y SOLO estos 3 campos (el DTO
 * del servidor rechaza `email`/`nombre` con 400). Al menos uno es obligatorio.
 */
export interface UsuarioActualizacion {
  activo?: boolean;
  rol?: string;
  password?: string;
}

// ─────────────── Etapa 9 — Dashboard, Departamentos, Entrevistas, Bitácora ───────────────

/**
 * Áreas LARCO (`GET /api/departamentos`, sembradas por la migración 009):
 * tarjeta con coordinador y contadores de embudo.
 */
export interface Departamento {
  id: string;
  nombre: string;
  coordinador: string;
  /** Candidatos etiquetados con este área (`candidatos.departamento_id`). */
  totalCandidatos: number;
  /** Requerimientos del área (cualquier estado). */
  totalRequerimientos: number;
  /** De ellos, los que están exactamente en `aprobado`. */
  requerimientosAprobados: number;
}

/** Cuerpo de `PATCH /api/departamentos/:id` (solo coordinador; admin/super). */
export interface DepartamentoActualizacion {
  coordinador: string;
}

/** Concentración del embudo ACTIVO en una de las 5 fases (`GET /api/dashboard`). */
export interface DashboardFase {
  /** Clave de la fase en BD (`preseleccion`, `antecedentes`, …). */
  fase: FasePostulacion;
  /** Postulaciones `activas` actualmente en la fase. */
  cantidad: number;
  /** Proporción 0–1 (2 decimales) del embudo activo que está en la fase. */
  tasaRetencion: number;
}

/** Contadores del embudo (cada candidato tiene a lo sumo UNA postulación). */
export interface DashboardEmbudo {
  /** Total de filas en `candidatos` (incluye los que aún sin postulación). */
  totalCandidatos: number;
  enProceso: number;
  descartados: number;
  contratados: number;
}

/** Contadores de requerimientos por estado + críticos abiertos. */
export interface DashboardRequerimientos {
  total: number;
  aprobados: number;
  pendientes: number;
  enProceso: number;
  /** Urgencia `critica` y AÚN sin desenlace (ni cerrado, rechazado ni exitoso). */
  criticos: number;
}

/** Respuesta de `GET /api/dashboard`. */
export interface Dashboard {
  embudo: DashboardEmbudo;
  /** Las 5 fases SIEMPRE en orden de avance, incluso con cantidad 0. */
  porFase: DashboardFase[];
  requerimientos: DashboardRequerimientos;
}

/** Estados del ENUM `estado_entrevista` (migración 009). */
export type EstadoEntrevista = 'agendada' | 'realizada' | 'cancelada';

/** Los 3 estados, en orden, para poblar selects y filtros. */
export const ESTADOS_ENTREVISTA: readonly EstadoEntrevista[] = [
  'agendada',
  'realizada',
  'cancelada',
];

/** Entrevista agenda (`GET /api/entrevistas`, con JOINs ya resueltos). */
export interface Entrevista {
  id: string;
  postulacionId: string;
  /** Fecha calendario `YYYY-MM-DD`. */
  fecha: string;
  /** Hora `HH:MM`, o `null` si la entrevista solo tiene día. */
  hora: string | null;
  tipo: string;
  entrevistador: string | null;
  estado: string;
  notas: string | null;
  candidato: { id: string; nombre: string };
  requerimiento: { id: string; codigo: string; titulo: string };
  creadoEn: string;
  actualizadoEn: string;
}

/** Cuerpo de `POST /api/entrevistas` (agendar sobre una postulación activa). */
export interface EntrevistaNueva {
  postulacionId: string;
  /** `YYYY-MM-DD` exacto. */
  fecha: string;
  /** `HH:MM` (24 h); opcional. */
  hora?: string;
  tipo: string;
  entrevistador?: string;
  notas?: string;
}

/** Cuerpo de `PATCH /api/entrevistas/:id` (parcial; `postulacionId` es fijo). */
export type EntrevistaActualizacion = Partial<
  Omit<EntrevistaNueva, 'postulacionId'> & { estado: EstadoEntrevista }
>;

/** Diferencia genérica de UN campo de la bitácora (valores ya enmascarados). */
export interface CambioAuditoria {
  campo: string;
  antes: unknown;
  despues: unknown;
}

/** Entrada de `audit_log` en forma pública (`GET /api/historial/auditoria`). */
export interface EntradaAuditoria {
  /** `audit_log.id` (bigserial; la API lo devuelve como string). */
  id: string;
  tabla: string;
  registroId: string;
  accion: 'INSERT' | 'UPDATE' | 'DELETE';
  /**
   * Nombre legible del registro («REQ-2026-001 — Vacante», «Juan Pérez»…),
   * resuelto en el servidor desde el snapshot. `null` = la tabla no aporta
   * nombre y se muestra el id corto.
   */
  etiqueta: string | null;
  /** Quién ejecutó la escritura (resuelto desde `users`; `null` si fue SQL). */
  actor: { id: string | null; email: string | null };
  fecha: string;
  /** Diff campo a campo (vacío en INSERT/DELETE). */
  cambios: CambioAuditoria[];
}

/** Página de la bitácora (`{ entradas, total, pagina, paginas }`). */
export interface PaginaAuditoria {
  entradas: EntradaAuditoria[];
  total: number;
  pagina: number;
  paginas: number;
}

/** Desenlace de UN archivo del lote importado (`POST /api/importacion/hvs`). */
export interface ResultadoImportacion {
  archivo: string;
  ok: boolean;
  /** Id del candidato creado (presente aunque el adjunto del CV falle). */
  candidatoId?: string;
  /** Motivo del fallo en español (solo cuando `ok` es falso). */
  motivo?: string;
}

/** Resumen de un lote de importación de HVs. */
export interface ResumenImportacion {
  procesados: number;
  creados: number;
  fallidos: number;
  resultados: ResultadoImportacion[];
}
