import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ValueTransformer } from 'typeorm';

/**
 * `numeric` llega desde `pg` como STRING (TypeORM no lo convierte) y se
 * devuelve igual. Este transformer mantiene sincronizado el tipo TS
 * (`number`) con el runtime. Es el mismo criterio que `transformerNumerico`
 * de `requerimiento.entity.ts`; se redefine aquí porque esa constante no está
 * exportada y el módulo de requerimientos queda intacto (cada entidad es
 * autosuficiente).
 */
const transformerNumerico: ValueTransformer = {
  to: (valor: number | null | undefined): number | null | undefined => valor,
  from: (valor: string | number | null | undefined): number | null | undefined =>
    valor === null || valor === undefined ? valor : Number(valor),
};

/**
 * Entidad que mapea EXACTAMENTE la tabla `candidatos` (migración 005).
 *
 * El esquema lo gestionan SIEMPRE las migraciones de node-pg-migrate:
 * `synchronize: false` aquí y en el `DataSource` — TypeORM solo lee y escribe,
 * nunca altera el esquema. CHECK, FK, índices, defaults y triggers viven en la
 * propia BD ("la base de datos manda").
 *
 * LA PII CIFRADA NO SE EXPONE AQUÍ EN CLARO:
 *  - `cedulaCifrada` / `telefonoCifrada` guardan `v1:<iv_b64>:<cipher_b64>`
 *    (producido por `CryptoService.encrypt`); la capa de servicio las
 *    descifra al montar la respuesta.
 *  - `cedulaHash` es el HMAC-SHA-256 (hex) de la cédula normalizada
 *    (`SearchHashService`): permite buscar por cédula SIN descifrar y NUNCA se
 *    devuelve por la API.
 *
 * Los campos NO cifrados (`ciudad`, `cargoActual`, `expectativaSalarial`,
 * `disponibilidad`, `notas`) no son PII sensible: se quedan en claro para poder
 * filtrar y paginar por ellos.
 */
@Entity({ name: 'candidatos', synchronize: false })
export class Candidato {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  nombres!: string;

  @Column({ type: 'text' })
  apellidos!: string;

  /** Opcional; si viene debe ser único (índice parcial `candidatos_email_unique`). */
  @Column({ type: 'text', nullable: true })
  email!: string | null;

  // ---------------------------------------------------------------------------
  // PII protegida (cifrada con AES-256-CBC, formato v1:...)
  // ---------------------------------------------------------------------------

  /**
   * Cédula CIFRADA (nunca en claro). `NULL` solo en candidatos creados por la
   * IMPORTACIÓN MASIVA de HVs (Etapa 9C) sin cédula en el CV: el analista la
   * completa luego desde la ficha. CHECK `candidatos_cedula_cifrada_check`.
   */
  @Column({ name: 'cedula_cifrada', type: 'text', nullable: true })
  cedulaCifrada!: string | null;

  /** Teléfono CIFRADO (opcional; `null` si el candidato no tiene teléfono). */
  @Column({ name: 'telefono_cifrada', type: 'text', nullable: true })
  telefonoCifrada!: string | null;

  /**
   * Hash de búsqueda HMAC-SHA-256 (hex, 64 chars) de la cédula normalizada.
   * ÚNICO en BD (índice PARCIAL `WHERE cedula_hash IS NOT NULL`, migración
   * 010): sostiene la búsqueda exacta y la detección de duplicados; los
   * candidatos importados sin cédula quedan en `NULL` y no colisionan.
   */
  @Column({ name: 'cedula_hash', type: 'text', nullable: true })
  cedulaHash!: string | null;

  // ---------------------------------------------------------------------------
  // Datos NO cifrados (no son PII sensible)
  // ---------------------------------------------------------------------------

  @Column({ type: 'text', nullable: true })
  ciudad!: string | null;

  /** Área LARCO del candidato (FK `departamentos(id)`, Etapa 9; nullable). */
  @Column({ name: 'departamento_id', type: 'uuid', nullable: true })
  departamentoId!: string | null;

  @Column({ name: 'cargo_actual', type: 'text', nullable: true })
  cargoActual!: string | null;

  @Column({
    name: 'expectativa_salarial',
    type: 'numeric',
    nullable: true,
    transformer: transformerNumerico,
  })
  expectativaSalarial!: number | null;

  @Column({ type: 'text', nullable: true })
  disponibilidad!: string | null;

  @Column({ type: 'text', nullable: true })
  notas!: string | null;

  // ---------------------------------------------------------------------------
  // Control temporal y autoría (los triggers `set_updated_at`/`audit_fila` mandan)
  // ---------------------------------------------------------------------------

  /** Autoría de la alta (FK a `users(id)` en BD). */
  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
