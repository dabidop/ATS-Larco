import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 009 — Etapa 9 (retroalimentación 22/10/2026): departamentos, entrevistas,
 * urgencia/modalidad, cierre con motivo+resultado, estado «exitoso» y un
 * candidato = UN requerimiento.
 *
 * Contexto de negocio: la primera ronda de retroalimentación del usuario pidió
 * (a) módulos nuevos (departamentos con sus coordinadores, calendario de
 * entrevistas), (b) reglas duras en el embudo (cupo de plazas, sin retroceso,
 * un candidato pertenece a UN solo requerimiento) y (c) seguimiento real del
 * cierre de un requerimiento (motivo obligatorio + si se contrató o no). Este
 * fichero deja la BASE DE DATOS mandando esos invariantes; la lógica de
 * servicio (Etapa 9B/9C) se apoya aquí.
 *
 * Contenido:
 *  1. ENUM `urgencia_requerimiento`: normal < alta < critica (badges del
 *     listado de requerimientos de la muestra).
 *  2. ENUM `modalidad_requerimiento`: directa | indirecta | terceros
 *     (Directa / Indirecta / Terceros(Contratistas) de la muestra).
 *  3. ENUM `resultado_cierre`: contratacion | cierre_vacante — ¿se contrató
 *     alguien o se cerró la vacante sin contratar?
 *  4. ENUM `estado_entrevista`: agendada | realizada | cancelada.
 *  5. `ALTER TYPE estado_requerimiento ADD VALUE 'exitoso'`: nuevo estado
 *     terminal «Contrato exitoso», alcanzado SOLO de forma automática cuando
 *     las contrataciones cubren las plazas pedidas (regla 3 de la
 *     retroalimentación). PG16 permite ADD VALUE dentro de la transacción de
 *     la migración SIEMPRE que el valor nuevo no se use en la misma; aquí solo
 *     se agrega. `IF NOT EXISTS` hace idempotente el re-up tras un down (el
 *     valor NO se puede eliminar del enum: residuo documentado e inofensivo).
 *  6. Tabla `departamentos` + SEED de las 8 áreas de LARCO con su coordinador
 *     (tal y como aparecen en la pantalla «Departamentos LARCO» de la
 *     muestra: Sistemas, Contabilidad, Gestión Humana, Abastecimiento,
 *     Prevención SST, Ofertas, Proyectos y Servicios).
 *  7. Tabla `entrevistas`: una entrevista se agenda SOBRE una postulación
 *     (candidato dentro de un requerimiento); `fecha` (calendarización),
 *     `hora`, `tipo`, `entrevistador`, `estado` y `notas`.
 *  8. `requerimientos`: columnas `urgencia` (default normal), `modalidad`
 *     (default directa), `departamento_id` (FK, nullable) y el par
 *     `motivo_cierre` + `resultado_cierre` con CHECK «cerrado ⇒ motivo y
 *     resultado» (regla 5 de la retroalimentación). Backfill determinista de
 *     los cerrados existentes.
 *  9. `candidatos`: columna `departamento_id` (FK, nullable) — el tag y el
 *     filtro de departamentos de «Base de Talentos», y el destino de la
 *     importación masiva.
 * 10. `postulaciones`: UN candidato pertenece a UN solo requerimiento (reglas
 *     6 y 8): se reemplaza `UNIQUE (candidato_id, requerimiento_id)` por
 *     `UNIQUE (candidato_id)`. Backfill determinista para datos previos: se
 *     conserva la postulación MÁS ANTIGUA de cada candidato y se eliminan las
 *     posteriores (artefactos de pruebas; en una BD que ya cumpla la regla no
 *     hace nada). `audit_log` NO se toca: es inmutable por diseño (008).
 *
 * Triggers: `set_updated_at` (001) y `audit_fila` (003/004) sobre las dos
 * tablas nuevas, idénticos al resto del esquema.
 */

/** Coordinadores por departamento, tal como aparecen en la muestra. */
const DEPARTAMENTOS: ReadonlyArray<{ nombre: string; coordinador: string }> = [
  { nombre: 'SISTEMAS', coordinador: 'Juan Munera' },
  { nombre: 'CONTABILIDAD', coordinador: 'Mary Luz Ortega Jaramillo' },
  { nombre: 'GESTION HUMANA', coordinador: 'Bibiana Betancur Morales' },
  { nombre: 'ABASTECIMIENTO', coordinador: 'Ana María García' },
  { nombre: 'PREVENCION SST', coordinador: 'Estefania Tascon Monsalve' },
  { nombre: 'OFERTAS', coordinador: 'Natalia Arango' },
  { nombre: 'PROYECTOS', coordinador: 'Carolina García Calle' },
  { nombre: 'SERVICIOS', coordinador: 'Mauricio Rivera' },
];

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1) Tipos ENUM nuevos
  // ---------------------------------------------------------------------------
  pgm.createType('urgencia_requerimiento', ['normal', 'alta', 'critica']);
  pgm.createType('modalidad_requerimiento', ['directa', 'indirecta', 'terceros']);
  pgm.createType('resultado_cierre', ['contratacion', 'cierre_vacante']);
  pgm.createType('estado_entrevista', ['agendada', 'realizada', 'cancelada']);

  // 2) Nuevo estado terminal del requerimiento (autoalcanzado, nunca manual).
  pgm.sql(`ALTER TYPE estado_requerimiento ADD VALUE IF NOT EXISTS 'exitoso'`);

  // ---------------------------------------------------------------------------
  // 3) Tabla departamentos + seed de las 8 áreas de LARCO
  // ---------------------------------------------------------------------------
  pgm.createTable('departamentos', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    nombre: { type: 'text', notNull: true, unique: true },
    coordinador: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTrigger('departamentos', 'departamentos_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });
  pgm.createTrigger('departamentos', 'departamentos_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'audit_fila',
  });

  // Seed determinista e idempotente: si la fila ya existe (re-up), no hace nada.
  const valores = DEPARTAMENTOS.map(
    ({ nombre, coordinador }) =>
      `  ('${nombre.replace(/'/g, "''")}', '${coordinador.replace(/'/g, "''")}')`,
  ).join(',\n');
  pgm.sql(
    `INSERT INTO departamentos (nombre, coordinador) VALUES\n${valores}\nON CONFLICT (nombre) DO NOTHING`,
  );

  // ---------------------------------------------------------------------------
  // 4) Tabla entrevistas (agendamiento sobre una postulación)
  // ---------------------------------------------------------------------------
  pgm.createTable('entrevistas', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    postulacion_id: {
      type: 'uuid',
      notNull: true,
      references: 'postulaciones(id)',
      onDelete: 'CASCADE',
    },
    fecha: { type: 'date', notNull: true },
    hora: { type: 'time' },
    tipo: { type: 'text', notNull: true, default: 'Entrevista' },
    entrevistador: { type: 'text' },
    estado: { type: 'estado_entrevista', notNull: true, default: 'agendada' },
    notas: { type: 'text' },
    created_by: { type: 'uuid', notNull: true, references: 'users(id)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Texto presente ⇒ no vacío (mismo criterio que el motivo de descarte en 007).
  pgm.addConstraint('entrevistas', 'entrevistas_texto_check', {
    check: `(
      (entrevistador IS NULL OR btrim(entrevistador) <> '')
      AND (notas IS NULL OR btrim(notas) <> '')
      AND btrim(tipo) <> ''
    )`,
  });

  pgm.createIndex('entrevistas', 'postulacion_id');
  pgm.createIndex('entrevistas', 'fecha');
  pgm.createIndex('entrevistas', 'estado');

  pgm.createTrigger('entrevistas', 'entrevistas_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });
  pgm.createTrigger('entrevistas', 'entrevistas_audit_log', {
    when: 'AFTER',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'audit_fila',
  });

  // ---------------------------------------------------------------------------
  // 5) requerimientos: urgencia, modalidad, departamento y cierre trazable
  // ---------------------------------------------------------------------------
  pgm.sql(`ALTER TABLE requerimientos
    ADD COLUMN urgencia urgencia_requerimiento NOT NULL DEFAULT 'normal',
    ADD COLUMN modalidad modalidad_requerimiento NOT NULL DEFAULT 'directa',
    ADD COLUMN departamento_id uuid REFERENCES departamentos(id) ON DELETE SET NULL,
    ADD COLUMN motivo_cierre text,
    ADD COLUMN resultado_cierre resultado_cierre`);

  pgm.createIndex('requerimientos', 'departamento_id');

  // Backfill de los cerrados PREVIOS a esta regla: motivo explícito y el
  // resultado deducido de si alguien quedó contratado en ese requerimiento.
  pgm.sql(`UPDATE requerimientos
    SET motivo_cierre = 'Cierre registrado antes de incorporar el motivo obligatorio',
        resultado_cierre = CASE WHEN EXISTS (
          SELECT 1 FROM postulaciones p
          WHERE p.requerimiento_id = requerimientos.id AND p.estado = 'contratado'
        ) THEN 'contratacion'::resultado_cierre ELSE 'cierre_vacante'::resultado_cierre END
    WHERE estado = 'cerrado' AND motivo_cierre IS NULL`);

  // «Cerrar» exige decir POR QUÉ y SI SE CONTRATÓ (regla 5 de la retroali.).
  pgm.addConstraint('requerimientos', 'requerimientos_cierre_check', {
    check: `estado <> 'cerrado'
      OR (motivo_cierre IS NOT NULL AND btrim(motivo_cierre) <> '' AND resultado_cierre IS NOT NULL)`,
  });

  // ---------------------------------------------------------------------------
  // 6) candidatos: departamento (tag/filtro de «Base de Talentos», destino de
  //    la importación masiva de HVs).
  // ---------------------------------------------------------------------------
  pgm.sql(`ALTER TABLE candidatos
    ADD COLUMN departamento_id uuid REFERENCES departamentos(id) ON DELETE SET NULL`);
  pgm.createIndex('candidatos', 'departamento_id');

  // ---------------------------------------------------------------------------
  // 7) postulaciones: UN candidato ⇒ UN requerimiento (reglas 6 y 8)
  // ---------------------------------------------------------------------------

  // Backfill determinista para datos previos a la regla: por cada candidato se
  // conserva su postulación MÁS ANTIGUA (menor created_at, empate por id) y se
  // eliminan las posteriores. Solo aplica a humo de pruebas: una BD que ya
  // cumpla 1:1 no tiene filas que borrar.
  pgm.sql(`DELETE FROM postulaciones p
    USING postulaciones keep
    WHERE p.candidato_id = keep.candidato_id
      AND p.id <> keep.id
      AND (p.created_at, p.id) > (keep.created_at, keep.id)`);

  pgm.dropConstraint('postulaciones', 'postulaciones_candidato_requerimiento_unique');
  // Nombre EXPLÍCITO: el servicio traduce el 23505 a un 409 con mensaje claro
  // («el candidato ya pertenece a otro requerimiento»).
  pgm.addConstraint('postulaciones', 'postulaciones_candidato_unico', {
    unique: ['candidato_id'],
  });

  // ---------------------------------------------------------------------------
  // 8) Verificación dura (patrón de 007): si algo de lo anterior no quedó
  //    materializado, la migración FALLA en vez de seguir con el esquema a
  //    medias.
  // ---------------------------------------------------------------------------
  pgm.sql(`DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'entrevistas_audit_log' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'El trigger entrevistas_audit_log no pudo crearse; la migración 009 está incompleta';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'departamentos_audit_log' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'El trigger departamentos_audit_log no pudo crearse; la migración 009 está incompleta';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'postulaciones_candidato_unico') THEN
      RAISE EXCEPTION 'La restricción postulaciones_candidato_unico no pudo crearse; la migración 009 está incompleta';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requerimientos_cierre_check') THEN
      RAISE EXCEPTION 'La restricción requerimientos_cierre_check no pudo crearse; la migración 009 está incompleta';
    END IF;
    IF (SELECT count(*) FROM departamentos) < 8 THEN
      RAISE EXCEPTION 'El seed de departamentos no insertó las 8 áreas de LARCO; la migración 009 está incompleta';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                   WHERE t.typname = 'estado_requerimiento' AND e.enumlabel = 'exitoso') THEN
      RAISE EXCEPTION 'El valor exitoso no se agregó a estado_requerimiento; la migración 009 está incompleta';
    END IF;
  END $$`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Orden exactamente inverso. NOTA: el valor 'exitoso' del ENUM
  // estado_requerimiento NO se puede eliminar en PostgreSQL (residuo
  // inofensivo; el re-up usa IF NOT EXISTS y es idempotente).

  // 1) postulaciones: se restaura el UNIQUE compuesto. (Las filas borradas por
  //    el backfill NO se recuperan: audit_log conserva su historial).
  pgm.dropConstraint('postulaciones', 'postulaciones_candidato_unico');
  pgm.addConstraint('postulaciones', 'postulaciones_candidato_requerimiento_unique', {
    unique: ['candidato_id', 'requerimiento_id'],
  });

  // 2) candidatos: se suelta la FK antes de borrar departamentos.
  pgm.dropIndex('candidatos', 'departamento_id');
  pgm.sql(`ALTER TABLE candidatos DROP COLUMN departamento_id`);

  // 3) requerimientos: CHECK, columnas e índices nuevos.
  pgm.dropConstraint('requerimientos', 'requerimientos_cierre_check');
  pgm.dropIndex('requerimientos', 'departamento_id');
  pgm.sql(`ALTER TABLE requerimientos
    DROP COLUMN urgencia,
    DROP COLUMN modalidad,
    DROP COLUMN departamento_id,
    DROP COLUMN motivo_cierre,
    DROP COLUMN resultado_cierre`);

  // 4) Tabla entrevistas (los triggers caen con la tabla; se dropean igual a
  //    mano siguiendo el patrón de 007).
  pgm.dropTrigger('entrevistas', 'entrevistas_audit_log');
  pgm.dropTrigger('entrevistas', 'entrevistas_set_updated_at');
  pgm.dropTable('entrevistas');
  pgm.dropType('estado_entrevista');

  // 5) Tabla departamentos.
  pgm.dropTrigger('departamentos', 'departamentos_audit_log');
  pgm.dropTrigger('departamentos', 'departamentos_set_updated_at');
  pgm.dropTable('departamentos');

  // 6) Enums nuevos (estado_entrevista cae con su columna vía dropTable).
  pgm.dropType('resultado_cierre');
  pgm.dropType('modalidad_requerimiento');
  pgm.dropType('urgencia_requerimiento');
}
