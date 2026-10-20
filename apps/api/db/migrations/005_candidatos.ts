import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 005 — Módulo de Candidatos con PII cifrada (Fase 4, parte 1).
 *
 * Contenido:
 *  1. Tabla `candidatos` con la PII sensible CIFRADA en la aplicación
 *     (`cedula_cifrada`, `telefono_cifrada`, formato `v1:...` de
 *     `CryptoService`) y un HASH DE BÚSQUEDA `cedula_hash` (HMAC-SHA-256 en
 *     hex de la cédula normalizada, con `CEDULA_SEARCH_KEY`).
 *  2. Constraints "la base de datos manda": los invariantes de formato son
 *     CHECK en PostgreSQL, no solo lógica de aplicación.
 *  3. Índices de lectura y los dos únicos que sostienen las reglas de negocio:
 *     `cedula_hash` único (sin duplicados) y `email` único SOLO cuando no es
 *     nulo (parcial).
 *  4. Triggers: `set_updated_at` + auditoría `audit_fila()` (ya genérica desde
 *     la migración 004, con el GUC `app.current_user_id`).
 *
 * DECISIONES DE DISEÑO (documentadas):
 *
 * - `origen_candidato` NO se modela. El plan lo dejaba como opcional ("si decides
 *   modelarlo") y ningún endpoint de esta fase lo lee ni lo escribe: añadir un
 *   ENUM cerrado ahora obligaría a una migración de tipo cada vez que el negocio
 *   añada un origen nuevo. Si más adelante hace falta, se agregará como
 *   `origen text` (lista abierta) sin tocar el resto del esquema.
 *
 * - Set de columnas NO cifradas (`ciudad`, `cargo_actual`, `expectativa_salarial`,
 *   `disponibilidad`, `notas`): se mantienen en claro porque NO son PII sensible
 *   según el plan; cifrarlas impediría filtrar/paginar por ellas sin descifrar.
 *   La PII protegida aquí es la cédula y el teléfono.
 *
 * - `cedula_hash` (hash de búsqueda): HMAC-SHA-256 con `CEDULA_SEARCH_KEY` sobre
 *   la cédula NORMALIZADA (solo dígitos), en hex de 64 caracteres. Permite
 *   buscar un candidato por cédula EXACTA SIN descifrar la columna
 *   `cedula_cifrada`. El HMAC con secreto evita el ataque de diccionario que
 *   tendría un hash simple sobre un espacio tan pequeño como las cédulas; no es
 *   reversible. Es UNIQUE: dos candidatos no pueden compartir cédula.
 *
 * - Formato cifrado garantizado en BD: `cedula_cifrada LIKE 'v1:%'` (y lo mismo
 *   para `telefono_cifrada` cuando no es nulo). Así la base de datos RECHAZA
 *   cualquier fila que no lleve PII cifrada con el esquema vigente; la app
 *   produce exactamente ese prefijo (`CryptoService.encrypt`).
 *
 * - `email` es opcional, pero SI viene debe ser único → índice ÚNICO PARCIAL
 *   `WHERE email IS NOT NULL` (admite muchos candidatos sin email, pero no dos
 *   con el mismo).
 *
 * Nota: `gen_random_uuid()` es nativo del núcleo de PostgreSQL >= 13 (el
 * proyecto corre sobre PostgreSQL 16), no hace falta `pgcrypto`.
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1) Tabla candidatos
  //
  // `numeric(12,2)` se declara en el propio tipo: node-pg-migrate ignora las
  // claves `precision`/`scale` al generar la columna (mismo detalle que 003).
  // ---------------------------------------------------------------------------
  pgm.createTable('candidatos', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    nombres: { type: 'text', notNull: true },
    apellidos: { type: 'text', notNull: true },
    email: { type: 'text' },
    // PII CIFRADA en la app (v1:<iv_b64>:<cipher_b64>), gestionada por CryptoService.
    cedula_cifrada: { type: 'text', notNull: true },
    telefono_cifrada: { type: 'text' },
    // Hash de búsqueda HMAC-SHA-256 (hex) de la cédula normalizada: UNIQUE abajo.
    cedula_hash: { type: 'text', notNull: true },
    ciudad: { type: 'text' },
    cargo_actual: { type: 'text' },
    expectativa_salarial: { type: 'numeric(12,2)' },
    disponibilidad: { type: 'text' },
    notas: { type: 'text' },
    created_by: { type: 'uuid', notNull: true, references: 'users(id)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // ---------------------------------------------------------------------------
  // 2) Constraints a nivel tabla ("la base de datos manda")
  // ---------------------------------------------------------------------------

  // La cédula SIEMPRE guardada cifrada con el esquema vigente (v1).
  pgm.addConstraint('candidatos', 'candidatos_cedula_cifrada_check', {
    check: "cedula_cifrada LIKE 'v1:%'",
  });

  // El teléfono es opcional; si existe, también debe estar cifrado (v1).
  pgm.addConstraint('candidatos', 'candidatos_telefono_cifrada_check', {
    check: "telefono_cifrada IS NULL OR telefono_cifrada LIKE 'v1:%'",
  });

  // El hash de búsqueda es HMAC-SHA-256 en hex: exactamente 64 dígitos hex.
  // Bloquea en BD cualquier `cedula_hash` que no sea un hash bien formado.
  pgm.addConstraint('candidatos', 'candidatos_cedula_hash_check', {
    check: "cedula_hash ~ '^[0-9a-f]{64}$'",
  });

  // El sueldo esperado nunca puede ser negativo (refuerza el @Min(0) del DTO).
  pgm.addConstraint('candidatos', 'candidatos_expectativa_salarial_check', {
    check: 'expectativa_salarial IS NULL OR expectativa_salarial >= 0',
  });

  // ---------------------------------------------------------------------------
  // 3) Índices de lectura y de unicidad
  //
  // Los dos ÚNICOS se crean con nombre EXPLÍCITO para que la capa de servicio
  // pueda mapear el error de BD 23505 (unique_violation) a un 409 con mensaje
  // claro, distinguiendo "cédula duplicada" de "email duplicado".
  // ---------------------------------------------------------------------------

  // Sin duplicados por cédula (búsqueda exacta vía hash).
  pgm.createIndex('candidatos', 'cedula_hash', {
    unique: true,
    name: 'candidatos_cedula_hash_unique',
  });

  // Email único SOLO cuando viene informado (parcial): admite N candidatos sin
  // email, pero impide dos con el mismo.
  pgm.createIndex('candidatos', 'email', {
    unique: true,
    where: 'email IS NOT NULL',
    name: 'candidatos_email_unique',
  });

  // Búsqueda por nombre (ILIKE). Un btree no acelera '%texto%' con comodín
  // inicial; si el listado por nombre se vuelve lento, la mejora natural es un
  // índice GIN sobre pg_trgm. Se mantiene el btree por simplicidad y porque el
  // volumen actual no lo justifica.
  pgm.createIndex('candidatos', 'nombres');
  // Listado por defecto ordenado por created_at DESC.
  pgm.createIndex('candidatos', 'created_at');

  // ---------------------------------------------------------------------------
  // 4) Triggers: updated_at + auditoría (reutiliza las funciones ya existentes)
  // ---------------------------------------------------------------------------

  // `set_updated_at` la creó la migración 001; `audit_fila` está en su versión
  // definitiva desde la migración 004 (prioriza el GUC del actor). Esta
  // migración NO redefine ninguna de las dos: solo crea los triggers sobre la
  // nueva tabla, con el MISMO patrón que `requerimientos` (003/004).
  pgm.createTrigger('candidatos', 'candidatos_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });

  pgm.createTrigger('candidatos', 'candidatos_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'audit_fila',
  });

  // Verificación dura: si el trigger de auditoría no quedó montado, la
  // migración falla ruidosamente en lugar de seguir sin historial.
  pgm.sql(`
DO $migrate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'candidatos_audit_log' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'El trigger candidatos_audit_log no pudo crearse; la migración 005 está incompleta';
  END IF;
END
$migrate$
`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Triggers antes que la tabla (dependen de ella y de las funciones 001/004).
  pgm.dropTrigger('candidatos', 'candidatos_audit_log');
  pgm.dropTrigger('candidatos', 'candidatos_set_updated_at');

  // `dropTable` elimina también los índices y constraints creados arriba.
  pgm.dropTable('candidatos');

  // `set_updated_at` (001), `audit_fila` (003/004) y el ENUM `estado_requerimiento`
  // (003) NO se tocan: pertenecen a migraciones anteriores y las sigue usando
  // el módulo de requerimientos. El `down` es reversible sin romper 001-004.
}
