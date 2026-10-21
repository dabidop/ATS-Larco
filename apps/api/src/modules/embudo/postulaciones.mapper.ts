import type { Estado, Fase } from './postulaciones-fases';
import type { PostulacionResponseDto, PostulacionRow } from './dto/postulacion.response';

/**
 * Mapeo EXPLÍCITO de postulaciones: fila BD (snake_case) ↔ respuesta API
 * (camelCase) y construcción del HISTORIAL desde `audit_log` (Fase 5).
 *
 * Fichero de funciones PURAS (sin BD, sin Nest): el servicio solo lo invoca,
 * y los unitarios lo prueban sin tocar PostgreSQL (mismo criterio que
 * `requerimientos-flujo.ts`).
 *
 * La tabla NO contiene PII (dos FK, fase, estado y motivo de descarte), así
 * que el historial no necesita enmascarar nada; lo que SÍ se descarta es toda
 * clave interna que el cliente no necesita.
 */

/** Mapea una fila `postulaciones` a su DTO público (fechas en ISO 8601). */
export function toResponse(fila: PostulacionRow): PostulacionResponseDto {
  return {
    id: fila.id,
    candidatoId: fila.candidato_id,
    requerimientoId: fila.requerimiento_id,
    // Los enums llegan de `pg` como string; el tipo público es el del dominio.
    fase: fila.fase as Fase,
    estado: fila.estado as Estado,
    motivoDescarte: fila.motivo_descarte,
    createdBy: fila.created_by,
    createdAt: fila.created_at.toISOString(),
    updatedAt: fila.updated_at.toISOString(),
  };
}

// ───────────────────────── historial de auditoría (audit_log) ─────────────────────────

/** Límite de entradas de `GET /api/postulaciones/:id/historial` (sin paginación). */
export const LIMITE_HISTORIAL = 200;

/**
 * Acciones que el CHECK `audit_log_action_check` admite. Sobre `postulaciones`
 * el trigger `postulaciones_audit_log` (migración 007) SOLO emite INSERT y
 * UPDATE —no hay trigger de borrado—; DELETE queda tipado por completitud y
 * hoy es inalcanzable para esta tabla.
 */
export type AccionHistorial = 'INSERT' | 'UPDATE' | 'DELETE';

/** Snapshot de `old_data`/`new_data` (jsonb) tal y como la entrega `pg`. */
export type DatosAuditoria = Record<string, unknown> | null;

/** Un campo concreto del historial (cambio del diff o alta/borrado completo). */
export interface CambioHistorialDto {
  /** Nombre PÚBLICO del campo (camelCase, como habla la API). */
  campo: string;
  /** Valor anterior; `null` en el alta. */
  antes: unknown;
  /** Valor posterior; `null` en un borrado. */
  despues: unknown;
}

/** Entrada del historial tal y como sale por `GET /api/postulaciones/:id/historial`. */
export interface EntradaHistorialPostulacionDto {
  /**
   * `audit_log.id` (bigserial) devuelto como TEXTO: `pg` entrega `int8` así
   * para no perder precisión en enteros mayores que 2^53.
   */
  id: string;
  accion: AccionHistorial;
  /** `created_at` en ISO 8601. */
  fecha: string;
  /** `changed_by`: uuid crudo del actor (fuente de verdad) o `null`. */
  usuario: string | null;
  /** Email del actor (LEFT JOIN a `users`, por PK); `null` si ya no existe. */
  usuarioEmail: string | null;
  campos: CambioHistorialDto[];
}

/**
 * Fila cruda de `audit_log` que devuelve el SQL del servicio (el email ya
 * viene resuelto de `users`).
 */
export interface FilaAuditoriaPostulacion {
  id: string;
  action: string;
  old_data: DatosAuditoria;
  new_data: DatosAuditoria;
  changed_by: string | null;
  usuario_email: string | null;
  created_at: Date | string;
}

/**
 * Whitelist de columnas del HISTORIAL: SOLO los 3 campos de negocio
 * (`fase`, `estado`, `motivo_descarte`), traducidos al camelCase de la API
 * (mismo criterio de puente explícito que `candidatos.mapper.ts`).
 *
 * DECISIÓN DOCUMENTADA — qué se expone del `audit_log`:
 *  - Esta tabla NO tiene PII, así que el `motivo_descarte` se expone TAL CUAL
 *    (es texto de negocio que el equipo de selección debe poder leer en el
 *    historial: «¿por qué se descartó?»).
 *  - Se DESCARTAN las claves internas: `id`, `candidato_id`,
 *    `requerimiento_id`, `created_by`, `created_at` y `updated_at`. Las FKs
 *    son constantes a lo largo de la vida de la fila (nunca cambian en un
 *    UPDATE) y el cliente ya las tiene en la propia postulación; `created_by`
 *    y los timestamps viajan en la entrada (`usuario`/`usuarioEmail` y
 *    `fecha`).
 *  - Cualquier columna DESCONOCIDA también se DESCARTA (fail-safe): si mañana
 *    aparece una columna nueva en `postulaciones` no se expone hasta que se
 *    decida aquí cómo presentarla.
 */
const COLUMNAS_HISTORIAL: Readonly<Record<string, string>> = {
  fase: 'fase',
  estado: 'estado',
  motivo_descarte: 'motivoDescarte',
};

/** Valor de `columna` en una snapshot jsonb, normalizado a `null`. */
function valorDe(datos: DatosAuditoria, columna: string): unknown {
  return datos?.[columna] ?? null;
}

/**
 * Campos de un ALTA: las columnas públicas con valor de `new_data`, con
 * `antes: null`. Los campos vacíos (`null`) se omiten: en un alta solo
 * informan los datos dados de alta.
 */
function camposDeAlta(nuevos: DatosAuditoria): CambioHistorialDto[] {
  const campos: CambioHistorialDto[] = [];
  for (const [columna, campo] of Object.entries(COLUMNAS_HISTORIAL)) {
    const valor = valorDe(nuevos, columna);
    if (valor !== null) {
      campos.push({ campo, antes: null, despues: valor });
    }
  }
  return campos;
}

/** Campos de un BORRADO (inalcanzable hoy en `postulaciones`): `despues: null`. */
function camposDeBorrado(antiguos: DatosAuditoria): CambioHistorialDto[] {
  const campos: CambioHistorialDto[] = [];
  for (const [columna, campo] of Object.entries(COLUMNAS_HISTORIAL)) {
    const valor = valorDe(antiguos, columna);
    if (valor !== null) {
      campos.push({ campo, antes: valor, despues: null });
    }
  }
  return campos;
}

/**
 * Campos que CAMBIARON entre dos snapshots jsonb de `audit_log`, en el orden
 * del whitelist. Los valores SIN cambios no aparecen (función PURA: se testea
 * sin BD).
 */
export function calcularCambiosHistorial(
  antes: DatosAuditoria,
  despues: DatosAuditoria,
): CambioHistorialDto[] {
  const cambios: CambioHistorialDto[] = [];
  for (const [columna, campo] of Object.entries(COLUMNAS_HISTORIAL)) {
    const valorAntes = valorDe(antes, columna);
    const valorDespues = valorDe(despues, columna);
    if (Object.is(valorAntes, valorDespues)) {
      continue;
    }
    cambios.push({ campo, antes: valorAntes, despues: valorDespues });
  }
  return cambios;
}

/** `timestamptz` de `pg` (Date) o texto → ISO 8601 estricto. */
function aIso8601(fecha: Date | string): string {
  return fecha instanceof Date ? fecha.toISOString() : new Date(fecha).toISOString();
}

/**
 * Fila cruda de `audit_log` → entrada pública del historial (función PURA).
 *
 * Cualquier `action` inesperada (imposible: el CHECK la acota a las tres
 * arriba) se trata como UPDATE para degradar sin PERDER la entrada.
 */
export function mapearEntradaHistorial(
  fila: FilaAuditoriaPostulacion,
): EntradaHistorialPostulacionDto {
  const accion: AccionHistorial =
    fila.action === 'INSERT' ? 'INSERT' : fila.action === 'DELETE' ? 'DELETE' : 'UPDATE';

  const campos =
    accion === 'INSERT'
      ? camposDeAlta(fila.new_data)
      : accion === 'DELETE'
        ? camposDeBorrado(fila.old_data)
        : calcularCambiosHistorial(fila.old_data, fila.new_data);

  return {
    id: fila.id,
    accion,
    fecha: aIso8601(fila.created_at),
    usuario: fila.changed_by,
    usuarioEmail: fila.usuario_email,
    campos,
  };
}
