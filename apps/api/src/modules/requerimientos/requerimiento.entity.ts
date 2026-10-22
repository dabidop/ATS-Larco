import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ValueTransformer } from 'typeorm';

/**
 * Estados del ciclo de vida de un requerimiento.
 *
 * El ORDEN de las claves replica el orden del ENUM `estado_requerimiento` de
 * PostgreSQL (migración 003 + 009):
 * pendiente → aprobado → en_proceso → cerrado | rechazado, más `exitoso`
 * (migración 009): «Contrato exitoso», estado TERMINAL que solo se alcanza de
 * forma AUTOMÁTICA cuando las contrataciones cubren las plazas pedidas (nunca
 * es destino de una transición manual).
 */
export enum EstadoRequerimiento {
  Pendiente = 'pendiente',
  Aprobado = 'aprobado',
  EnProceso = 'en_proceso',
  Cerrado = 'cerrado',
  Rechazado = 'rechazado',
  Exitoso = 'exitoso',
}

/** Prioridad del requerimiento (ENUM `urgencia_requerimiento`, migración 009). */
export enum UrgenciaRequerimiento {
  Normal = 'normal',
  Alta = 'alta',
  Critica = 'critica',
}

/**
 * Modalidad de contratación (ENUM `modalidad_requerimiento`, migración 009).
 * `Terceros` se muestra en UI como «Terceros/Contratistas» (muestra).
 */
export enum ModalidadRequerimiento {
  Directa = 'directa',
  Indirecta = 'indirecta',
  Terceros = 'terceros',
}

/**
 * Resultado del cierre (ENUM `resultado_cierre`, migración 009): ¿se cerró el
 * requerimiento CON alguien contratado o vacía? Obligatorio al cerrar (CHECK
 * `requerimientos_cierre_check`).
 */
export enum ResultadoCierre {
  Contratacion = 'contratacion',
  CierreVacante = 'cierre_vacante',
}

/**
 * `numeric` llega desde `pg` como STRING (TypeORM no lo convierte) y se
 * devuelve igual. Este transformer mantiene sincronizado el tipo TS
 * (`number`) con el runtime: sin él, una comparación tipo
 * `salarioMin <= salarioMax` terminaría comparando cadenas ("9000" > "10000").
 * El rango lo garantiza igualmente la BD (`requerimientos_salario_rango_check`).
 */
const transformerNumerico: ValueTransformer = {
  to: (valor: number | null | undefined): number | null | undefined => valor,
  from: (valor: string | number | null | undefined): number | null | undefined =>
    valor === null || valor === undefined ? valor : Number(valor),
};

/**
 * Entidad que mapea EXACTAMENTE la tabla `requerimientos` (migración 003).
 *
 * El esquema lo gestionan SIEMPRE las migraciones de node-pg-migrate:
 * `synchronize: false` aquí y en el `DataSource` — TypeORM solo lee y escribe,
 * nunca altera el esquema. Por eso los decoradores declaran tipos y nombres de
 * columna; CHECK, FK, índices, defaults y triggers viven en la propia BD
 * ("la base de datos manda").
 *
 * Orden de propiedades = orden de las 5 secciones del formulario:
 * 1) identificación/jefatura, 2) perfil profesional, 3) conocimientos y
 * habilidades, 4) condiciones salariales/contractuales, 5) justificación.
 */
@Entity({ name: 'requerimientos', synchronize: false })
export class Requerimiento {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Código correlativo `REQ-YYYY-NNN` (CHECK `requerimientos_code_check`). */
  @Column({ type: 'text', unique: true })
  code!: string;

  @Column({
    type: 'enum',
    enum: EstadoRequerimiento,
    enumName: 'estado_requerimiento',
    default: EstadoRequerimiento.Pendiente,
  })
  estado!: EstadoRequerimiento;

  /** Autoría de la solicitud (FK a `users(id)` en BD). */
  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  // ---------------------------------------------------------------------------
  // Sección 1 — identificación y jefatura
  // ---------------------------------------------------------------------------

  /** Puesto solicitado. */
  @Column({ type: 'text' })
  titulo!: string;

  @Column({ type: 'text' })
  jefatura!: string;

  @Column({ name: 'numero_plazas', type: 'int' })
  numeroPlazas!: number;

  /** Prioridad (badges CRÍTICA/ALTA/NORMAL del listado de la muestra). */
  @Column({
    type: 'enum',
    enum: UrgenciaRequerimiento,
    enumName: 'urgencia_requerimiento',
    default: UrgenciaRequerimiento.Normal,
  })
  urgencia!: UrgenciaRequerimiento;

  /** Directa | Indirecta | Terceros («Terceros/Contratistas» en UI). */
  @Column({
    type: 'enum',
    enum: ModalidadRequerimiento,
    enumName: 'modalidad_requerimiento',
    default: ModalidadRequerimiento.Directa,
  })
  modalidad!: ModalidadRequerimiento;

  /** Área LARCO solicitante (FK `departamentos(id)`; nullable). */
  @Column({ name: 'departamento_id', type: 'uuid', nullable: true })
  departamentoId!: string | null;

  @Column({ type: 'text', nullable: true })
  ubicacion!: string | null;

  /** `'YYYY-MM-DD'`: el driver hidrata `date` como string, no como Date. */
  @Column({ name: 'fecha_requerida', type: 'date', nullable: true })
  fechaRequerida!: string | null;

  // ---------------------------------------------------------------------------
  // Sección 2 — perfil profesional
  // ---------------------------------------------------------------------------

  @Column({ name: 'experiencia_requerida', type: 'text', nullable: true })
  experienciaRequerida!: string | null;

  @Column({ name: 'nivel_educacion', type: 'text', nullable: true })
  nivelEducacion!: string | null;

  @Column({ name: 'perfil_profesional', type: 'text' })
  perfilProfesional!: string;

  // ---------------------------------------------------------------------------
  // Sección 3 — conocimientos y habilidades (`text[]` en BD)
  // ---------------------------------------------------------------------------

  @Column({ type: 'text', array: true, default: '{}' })
  conocimientos!: string[];

  @Column({ type: 'text', array: true, default: '{}' })
  habilidades!: string[];

  // ---------------------------------------------------------------------------
  // Sección 4 — condiciones salariales y contractuales
  // ---------------------------------------------------------------------------

  @Column({
    name: 'salario_min',
    type: 'numeric',
    nullable: true,
    transformer: transformerNumerico,
  })
  salarioMin!: number | null;

  @Column({
    name: 'salario_max',
    type: 'numeric',
    nullable: true,
    transformer: transformerNumerico,
  })
  salarioMax!: number | null;

  @Column({ name: 'tipo_contrato', type: 'text', nullable: true })
  tipoContrato!: string | null;

  @Column({ type: 'text', nullable: true })
  jornada!: string | null;

  // ---------------------------------------------------------------------------
  // Sección 5 — justificación
  // ---------------------------------------------------------------------------

  @Column({ type: 'text' })
  justificacion!: string;

  /** Obligatorio cuando `estado = 'rechazado'` (CHECK en BD). */
  @Column({ name: 'motivo_rechazo', type: 'text', nullable: true })
  motivoRechazo!: string | null;

  /** Obligatorio cuando `estado = 'cerrado'` (CHECK `requerimientos_cierre_check`). */
  @Column({ name: 'motivo_cierre', type: 'text', nullable: true })
  motivoCierre!: string | null;

  /** `contratacion` | `cierre_vacante`: ¿se contrató o se vació la plaza? */
  @Column({
    name: 'resultado_cierre',
    type: 'enum',
    enum: ResultadoCierre,
    enumName: 'resultado_cierre',
    nullable: true,
  })
  resultadoCierre!: ResultadoCierre | null;

  // ---------------------------------------------------------------------------
  // Control temporal (los triggers `set_updated_at`/`audit_fila` mandan)
  // ---------------------------------------------------------------------------

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
