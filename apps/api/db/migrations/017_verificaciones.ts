import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 017 — VERIFICACIONES ASÍNCRONAS (Objetivo D del alcance).
 *
 * Contexto: las fases 2 (`antecedentes`) y 4 (`proveedor_externo`) del Kanban
 * existían como columnas vacías. El PDF exige verificaciones asíncronas con
 * Playwright, resultados estructurados en JSONB, evidencia y estados. Esta
 * migración crea el modelo que sostiene ese flujo; el worker y los drivers
 * viven en `apps/api/src/modules/verificaciones`.
 *
 * Contenido:
 *  1. ENUM `tipo_verificacion`: antecedentes | poligrafo | proveedor_externo.
 *  2. ENUM `estado_verificacion`: pendiente | en_proceso | completada |
 *     fallida | cancelada.
 *  3. ENUM `resultado_verificacion`: aprobado | rechazado | inconcluso.
 *  4. Tabla `verificaciones`: UNA fila por solicitud de verificación sobre una
 *     postulación. Actúa como COLA PERSISTENTE (no hay broker externo): el
 *     worker reclama filas con `FOR UPDATE SKIP LOCKED`, de modo que un
 *     reinicio de la API no pierde trabajo.
 *  5. Tabla `verificacion_eventos`: bitácora APPEND-ONLY de cada paso del
 *     worker (reclamo, navegación, captura, resultado, reintento, error).
 *  6. Índices de cola y de lectura + constraint única parcial que impide DOS
 *     verificaciones activas del mismo tipo para una postulación.
 *  7. Triggers `set_updated_at` + `audit_fila()` (patrón 001/004/007).
 *
 * DECISIONES DE DISEÑO (documentadas):
 *
 * - **La cola vive en PostgreSQL, no en memoria.** `bloqueado_hasta` es el
 *   LEASE del worker: si el proceso muere a mitad de una verificación, el
 *   lease expira y otro worker la reclama. `intentos`/`max_intentos` permiten
 *   backoff y un estado terminal `fallida` sin bucle infinito.
 *
 * - **La PII NO se copia a esta tabla.** `detalle` guarda solo contexto no
 *   sensible (ids, código del requerimiento, origen). La cédula y el teléfono
 *   se descifran EN MEMORIA al ejecutar el job, desde `candidatos`, y el
 *   resultado se guarda ENMASCARADO (últimos 4 dígitos). Así una fila de
 *   `verificaciones` o una captura de evidencia no se convierte en una segunda
 *   copia de la PII.
 *
 * - **El polígrafo es su propio tipo**, aunque se dispare junto a
 *   `proveedor_externo`: el alcance pide poder restringir su lectura
 *   (`puedeVerPoligrafo`, admin_rrhh/superusuario) y tratarlo como PII
 *   sensible. El resultado estructurado del polígrafo se guarda en
 *   `resultado_datos` (JSONB); el detalle textual sensible se cifra antes de
 *   escribirlo (el servicio lo hace con CryptoService).
 *
 * - **Los estados son terminales explícitos**: `completada` exige `resultado`
 *   y `finalizado_en`; `fallida`/`cancelada` exigen `finalizado_en` y NO
 *   admiten resultado. Los CHECK lo garantizan en BD, no solo en la app.
 *
 * - **Una sola verificación ACTIVA por (postulación, tipo)**: índice único
 *   parcial sobre `estado IN ('pendiente','en_proceso')`. Un reintento reusa
 *   la MISMA fila (vuelve a `pendiente`), no crea otra.
 *
 * - `ON DELETE CASCADE` desde `postulaciones`: si la postulación desaparece,
 *   sus verificaciones y eventos también. `solicitado_por` es
 *   `ON DELETE SET NULL` para conservar la traza aunque se borre la cuenta.
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1) Tipos ENUM
  // ---------------------------------------------------------------------------
  pgm.createType('tipo_verificacion', ['antecedentes', 'poligrafo', 'proveedor_externo']);
  pgm.createType('estado_verificacion', [
    'pendiente',
    'en_proceso',
    'completada',
    'fallida',
    'cancelada',
  ]);
  pgm.createType('resultado_verificacion', ['aprobado', 'rechazado', 'inconcluso']);

  // ---------------------------------------------------------------------------
  // 2) Tabla verificaciones (cola persistente)
  // ---------------------------------------------------------------------------
  pgm.createTable('verificaciones', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    postulacion_id: {
      type: 'uuid',
      notNull: true,
      references: 'postulaciones(id)',
      onDelete: 'CASCADE',
    },
    tipo: { type: 'tipo_verificacion', notNull: true },
    estado: { type: 'estado_verificacion', notNull: true, default: 'pendiente' },
    resultado: { type: 'resultado_verificacion' },
    /** Identifica el driver/fuente que produjo el resultado (`simulado`, `playwright:...`). */
    proveedor: { type: 'text', notNull: true, default: 'simulado' },
    intentos: { type: 'integer', notNull: true, default: 0 },
    max_intentos: { type: 'integer', notNull: true, default: 3 },
    /** Mayor prioridad se procesa antes (0 = normal). */
    prioridad: { type: 'smallint', notNull: true, default: 0 },
    solicitado_por: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    // Lease del worker: si `now() > bloqueado_hasta`, la fila es reclamable.
    worker_id: { type: 'text' },
    bloqueado_hasta: { type: 'timestamptz' },
    iniciado_en: { type: 'timestamptz' },
    finalizado_en: { type: 'timestamptz' },
    /** Contexto NO sensible del job (ids, código de requerimiento, origen). */
    detalle: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    /** Resultado estructurado normalizado por el driver (JSONB). */
    resultado_datos: { type: 'jsonb' },
    /** Evidencia capturada: [{ tipo, nombre, ruta, sha256, bytes, contentType }]. */
    evidencia: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // ---------------------------------------------------------------------------
  // 3) Constraints ("la base de datos manda")
  // ---------------------------------------------------------------------------

  // Completada ⇔ resultado presente. Ni una completada sin veredicto ni una
  // pendiente con veredicto (sería un resultado huérfano de estado).
  pgm.addConstraint('verificaciones', 'verificaciones_resultado_check', {
    check: `(estado = 'completada') = (resultado IS NOT NULL)`,
  });

  // Los estados terminales SIEMPRE tienen fecha de finalización; los vivos no.
  pgm.addConstraint('verificaciones', 'verificaciones_finalizada_check', {
    check: `(estado IN ('completada', 'fallida', 'cancelada')) = (finalizado_en IS NOT NULL)`,
  });

  // Reintentos acotados: nunca más de `max_intentos` y siempre > 0.
  pgm.addConstraint('verificaciones', 'verificaciones_intentos_check', {
    check: 'intentos >= 0 AND max_intentos > 0 AND intentos <= max_intentos',
  });

  // Un error, si existe, no puede ser solo espacios.
  pgm.addConstraint('verificaciones', 'verificaciones_error_check', {
    check: `error IS NULL OR btrim(error) <> ''`,
  });

  // Una verificación en curso no puede estar "bloqueada" sin worker.
  pgm.addConstraint('verificaciones', 'verificaciones_worker_check', {
    check: `estado <> 'en_proceso' OR (worker_id IS NOT NULL AND bloqueado_hasta IS NOT NULL)`,
  });

  // ---------------------------------------------------------------------------
  // 4) Índices
  // ---------------------------------------------------------------------------

  // UNA sola verificación activa por postulación y tipo (los reintentos reusan
  // la fila). Cierra la carrera de dos peticiones simultáneas.
  pgm.sql(`CREATE UNIQUE INDEX verificaciones_activa_unica
             ON verificaciones (postulacion_id, tipo)
          WHERE estado IN ('pendiente', 'en_proceso')`);

  // Cola: el worker ordena por prioridad y antigüedad dentro de los estados vivos.
  pgm.sql(`CREATE INDEX verificaciones_cola_idx
             ON verificaciones (prioridad DESC, created_at ASC)
          WHERE estado IN ('pendiente', 'en_proceso')`);

  // Lectura por postulación/tipo, la que usa el gate de fases y el panel.
  pgm.createIndex('verificaciones', ['postulacion_id', 'tipo', 'created_at']);
  pgm.createIndex('verificaciones', 'estado');
  pgm.createIndex('verificaciones', 'tipo');

  // ---------------------------------------------------------------------------
  // 5) Tabla verificacion_eventos (append-only)
  // ---------------------------------------------------------------------------
  pgm.createTable('verificacion_eventos', {
    id: { type: 'bigserial', primaryKey: true },
    verificacion_id: {
      type: 'uuid',
      notNull: true,
      references: 'verificaciones(id)',
      onDelete: 'CASCADE',
    },
    /** `reclamo`, `navegacion`, `evidencia`, `resultado`, `reintento`, `error`... */
    tipo: { type: 'text', notNull: true },
    mensaje: { type: 'text', notNull: true },
    datos: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('verificacion_eventos', 'verificacion_eventos_texto_check', {
    check: `btrim(tipo) <> '' AND btrim(mensaje) <> ''`,
  });

  pgm.createIndex('verificacion_eventos', ['verificacion_id', 'created_at']);

  // ---------------------------------------------------------------------------
  // 6) Triggers: updated_at + auditoría (funciones ya existentes)
  // ---------------------------------------------------------------------------
  pgm.createTrigger('verificaciones', 'verificaciones_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });

  pgm.createTrigger('verificaciones', 'verificaciones_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'audit_fila',
  });

  // Verificación dura: si los índices, CHECK o triggers no quedaron, la
  // migración falla en vez de dejar una cola sin garantías.
  pgm.sql(`
DO $migrate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'verificaciones_activa_unica'
  ) THEN
    RAISE EXCEPTION 'El índice verificaciones_activa_unica no se creó; la migración 017 está incompleta';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'verificaciones_resultado_check'
       AND conrelid = 'verificaciones'::regclass
  ) THEN
    RAISE EXCEPTION 'La constraint verificaciones_resultado_check no se creó; la migración 017 está incompleta';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'verificaciones_audit_log' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'El trigger verificaciones_audit_log no se creó; la migración 017 está incompleta';
  END IF;
END
$migrate$
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Eventos primero: su FK apunta a verificaciones.
  pgm.dropTable('verificacion_eventos');

  pgm.dropTrigger('verificaciones', 'verificaciones_audit_log');
  pgm.dropTrigger('verificaciones', 'verificaciones_set_updated_at');
  pgm.dropTable('verificaciones');

  pgm.dropType('resultado_verificacion');
  pgm.dropType('estado_verificacion');
  pgm.dropType('tipo_verificacion');
}
