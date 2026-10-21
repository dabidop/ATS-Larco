import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 007 — Postulaciones: el embudo de selección por fases (Fase 5, parte backend).
 *
 * Contenido:
 *  1. ENUM `fase_postulacion`: las 5 columnas del tablero Kanban, EN ORDEN —
 *     `preseleccion → antecedentes → entrevistas → proveedor_externo →
 *     contratacion`. El orden del tipo es observable y es la base sobre la que
 *     la capa de servicio calcula qué movimiento es adyacente.
 *  2. ENUM `estado_postulacion`: `activa` + los dos estados TERMINALES
 *     (`contratado`, `descartado`).
 *  3. Tabla `postulaciones`: UNA fila por (candidato, requerimiento). Tabla
 *     AUTOCONTENIDA: no guarda PII ni nombres, solo las dos FK y el estado del
 *     embudo, de modo que el módulo `embudo` puede existir sin importar a
 *     `CandidatosModule` ni a `RequerimientosModule` (sin ciclos de módulos).
 *  4. Constraints "la base de datos manda" (los invariantes SON CHECK, no solo
 *     lógica de aplicación) y el único que sostiene una regla de negocio.
 *  5. Índices de lectura del tablero y del listado.
 *  6. Triggers `set_updated_at` + `audit_fila()` (INSERT/UPDATE) con la
 *     verificación dura del patrón 005/006.
 *
 * DECISIONES DE DISEÑO (documentadas):
 *
 * - **`postulaciones_descarte_check` — el motivo de descarte es OBLIGATORIO y
 *   exclusivo del descarte.** Expresión exacta:
 *
 *     (estado = 'descartado' AND motivo_descarte IS NOT NULL AND btrim(motivo_descarte) <> '')
 *     OR
 *     (estado <> 'descartado' AND (motivo_descarte IS NULL OR btrim(motivo_descarte) = ''))
 *
 *   Dos reglas en un solo CHECK, evaluadas SIEMPRE juntas:
 *    (a) `descartado` → `motivo_descarte` NO puede ser NULL ni estar vacío (ni
 *        ser solo espacios: `btrim` recorta). El descarte SIN motivo es
 *        imposible en BD, no solo en la API (el DTO añade un 400 amable).
 *    (b) `estado <> 'descartado'` → `motivo_descarte` NO puede estar poblado.
 *        Una postulación `activa` o `contratado` con motivo de descarte sería
 *        mentira: el motivo solo existe si hay un descarte que lo justifique.
 *        Un `''` vacío sí se tolera en (b) porque no «pobla» nada (evita
 *        castigar escrituras que normalizan el texto vacío a string vacío);
 *        lo que NO se tolera nunca es texto.
 *
 * - **`postulaciones_contratacion_check` — llegar a `contratacion` ES
 *   contratar.** Expresión exacta: `(estado = 'contratado') = (fase = 'contratacion')`.
 *   Es una igualdad booleana entre dos predicados, y por tanto exige las dos
 *   direcciones:
 *    (a) `contratado → fase = 'contratacion'`: nadie queda contratado «a mitad
 *        del embudo».
 *    (b) `fase = 'contratacion' → estado = 'contratado'`: NUNCA una fila puede
 *        estar `activa` (ni `descartada`) en la fase de contratación. La API ya
 *        lo garantiza (un `PATCH /:id/fase` con destino `contratacion` fija
 *        `estado = 'contratado'` en la MISMA operación), y este CHECK lo cierra
 *        también ante escrituras directas en BD.
 *
 * - **`UNIQUE (candidato_id, requerimiento_id)`** — un candidato postula UNA
 *   vez por requerimiento (duplicado → 409 en la capa de servicio, que traduce
 *   el 23505, y también hay chequeo previo). El índice resultante cubre además
 *   las consultas que filtran SOLO por `candidato_id` (columna izquierda del
 *   índice), por eso NO se crea un índice extra para `candidato_id`.
 *
 * - `candidato_id` y `requerimiento_id` con `ON DELETE CASCADE`: si algún día
 *   existiera borrado de un candidato o de un requerimiento, su postulación los
 *   seguiría en una única operación atómica. Hoy no hay `DELETE` de esos
 *   recursos por API (trazabilidad; ver `CandidatosController` y
 *   `RequerimientosController`), así que la cascada es sobre todo una
 *   definición correcta del esquema.
 *
 * - Auditoría SOLO en `INSERT`/`UPDATE` (mismo alcance que `candidatos` y
 *   `archivos_cv`). El `audit_log` escribe el trigger `audit_fila()` (versión
 *   004): prioriza el GUC `app.current_user_id`, que la capa de servicio fija
 *   con el `sub` del JWT dentro de la transacción de escritura, de modo que
 *   `changed_by` registra a QUIÉN mueve la fase o descarta, no al autor del
 *   alta. `audit_log` NO se limpia jamás (inmutable por diseño).
 *
 * - Sin `motivo` de movimientos: el único texto libre de la tabla es
 *   `motivo_descarte`. Un comentario opcional de «por qué se mueve de fase»
 *   NO tiene columna porque el CHECK anterior reservaría `motivo_descarte` para
 *   el descarte; si el negocio lo pide, se añadirá una columna propia.
 *
 * Nota: `gen_random_uuid()` es nativo del núcleo de PostgreSQL >= 13 (el
 * proyecto corre sobre PostgreSQL 16), no hace falta `pgcrypto`.
 */

/**
 * Orden EXACTO del ENUM de fases: es el orden de las columnas del tablero y la
 * base para calcular adyacencia (`|indice_origen - indice_destino| = 1`).
 */
const FASES: string[] = [
  'preseleccion',
  'antecedentes',
  'entrevistas',
  'proveedor_externo',
  'contratacion',
];

/** Estados: `activa` y los dos TERMINALES (`contratado`, `descartado`). */
const ESTADOS: string[] = ['activa', 'contratado', 'descartado'];

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1) Tipos ENUM
  // ---------------------------------------------------------------------------
  pgm.createType('fase_postulacion', FASES);
  pgm.createType('estado_postulacion', ESTADOS);

  // ---------------------------------------------------------------------------
  // 2) Tabla postulaciones
  // ---------------------------------------------------------------------------
  pgm.createTable('postulaciones', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    candidato_id: {
      type: 'uuid',
      notNull: true,
      references: 'candidatos(id)',
      onDelete: 'CASCADE',
    },
    requerimiento_id: {
      type: 'uuid',
      notNull: true,
      references: 'requerimientos(id)',
      onDelete: 'CASCADE',
    },
    // Fase de inicio del embudo: toda postulación NACE en preseleccion.
    fase: { type: 'fase_postulacion', notNull: true, default: 'preseleccion' },
    estado: { type: 'estado_postulacion', notNull: true, default: 'activa' },
    // NULL salvo `estado = 'descartado'` (lo garantiza el CHECK de abajo).
    motivo_descarte: { type: 'text' },
    created_by: { type: 'uuid', notNull: true, references: 'users(id)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // `updated_at` lo mantiene el trigger `set_updated_at` (migración 001).
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // ---------------------------------------------------------------------------
  // 3) Constraints a nivel tabla ("la base de datos manda")
  // ---------------------------------------------------------------------------

  // (a) descartado ⇒ motivo poblado  (b) motivo poblado ⇒ descartado.
  pgm.addConstraint('postulaciones', 'postulaciones_descarte_check', {
    check: `(
      (estado = 'descartado' AND motivo_descarte IS NOT NULL AND btrim(motivo_descarte) <> '')
      OR
      (estado <> 'descartado' AND (motivo_descarte IS NULL OR btrim(motivo_descarte) = ''))
    )`,
  });

  // En la fase de contratación SOLO hay contratados (y todo contratado está
  // allí): `activa` o `descartado` en `contratacion` es un estado imposible.
  pgm.addConstraint('postulaciones', 'postulaciones_contratacion_check', {
    check: `(estado = 'contratado') = (fase = 'contratacion')`,
  });

  // Nombre EXPLÍCITO: la capa de servicio traduce el 23505 a un 409 con
  // mensaje claro (además del chequeo previo que responde sin llegar a BD).
  pgm.addConstraint('postulaciones', 'postulaciones_candidato_requerimiento_unique', {
    unique: ['candidato_id', 'requerimiento_id'],
  });

  // ---------------------------------------------------------------------------
  // 4) Índices de lectura
  // ---------------------------------------------------------------------------

  // Tablero Kanban: `GET /api/postulaciones?requerimientoId=...` agrupado por
  // `fase` (el índice de `fase` acelera el GROUP BY / el filtro por columna).
  pgm.createIndex('postulaciones', 'requerimiento_id');
  pgm.createIndex('postulaciones', 'fase');
  // Listado por defecto ordenado por created_at DESC.
  pgm.createIndex('postulaciones', 'created_at');
  // `candidato_id` NO lleva índice propio: lo cubre la columna izquierda del
  // único `postulaciones_candidato_requerimiento_unique`.

  // ---------------------------------------------------------------------------
  // 5) Triggers: updated_at + auditoría (reutiliza las funciones ya existentes)
  // ---------------------------------------------------------------------------

  // `set_updated_at` la creó la migración 001 y `audit_fila` está en su versión
  // definitiva desde la 004 (prioriza el GUC del actor). Esta migración NO
  // redefine ninguna de las dos: solo monta los triggers sobre la nueva tabla.
  pgm.createTrigger('postulaciones', 'postulaciones_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });

  pgm.createTrigger('postulaciones', 'postulaciones_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'audit_fila',
  });

  // Verificación dura: si el trigger de auditoría o los CHECK de coherencia no
  // quedaron montados, la migración FALLA ruidosamente en lugar de seguir sin
  // historial o sin la red de seguridad que garantiza el motivo de descarte.
  pgm.sql(`
DO $migrate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'postulaciones_audit_log' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'El trigger postulaciones_audit_log no pudo crearse; la migración 007 está incompleta';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'postulaciones_descarte_check'
       AND conrelid = 'postulaciones'::regclass
  ) THEN
    RAISE EXCEPTION 'La constraint postulaciones_descarte_check no pudo crearse; la migración 007 está incompleta';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'postulaciones_contratacion_check'
       AND conrelid = 'postulaciones'::regclass
  ) THEN
    RAISE EXCEPTION 'La constraint postulaciones_contratacion_check no pudo crearse; la migración 007 está incompleta';
  END IF;
END
$migrate$
`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Triggers antes que la tabla (dependen de ella y de las funciones 001/004).
  pgm.dropTrigger('postulaciones', 'postulaciones_audit_log');
  pgm.dropTrigger('postulaciones', 'postulaciones_set_updated_at');

  // `dropTable` elimina también los índices y constraints creados arriba,
  // incluidas las dos FK con ON DELETE CASCADE.
  pgm.dropTable('postulaciones');

  // Tipos al final: ya no hay columnas que los referencien.
  pgm.dropType('estado_postulacion');
  pgm.dropType('fase_postulacion');

  // `set_updated_at` (001) y `audit_fila` (003/004) NO se tocan: los siguen
  // usando `users`, `requerimientos`, `candidatos` y `archivos_cv`. El `down`
  // es reversible sin romper 001-006. `audit_log` conserva sus filas.
}
