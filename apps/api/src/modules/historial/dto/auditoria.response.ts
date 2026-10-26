/**
 * Diferencia genérica de UN campo entre `old_data` y `new_data` (Etapa 9,
 * bitácora del `superusuario`). Los valores llegan ya ENMASCARADOS: cualquier
 * clave sensible (`*_cifrada(s)`, `*_hash`) se sustituyó antes de salir.
 */
export interface CambioAuditoriaDto {
  campo: string;
  antes: unknown;
  despues: unknown;
}

/** Entrada de `audit_log` en forma pública (Etapa 9). */
export interface EntradaAuditoriaDto {
  /** `audit_log.id` (bigserial; `pg` lo devuelve como string). */
  id: string;
  tabla: string;
  registroId: string;
  accion: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Quién ejecutó la escritura (resuelto desde `users`). */
  actor: { id: string | null; email: string | null };
  fecha: string;
  /** Diff campo a campo (vacío en INSERT/DELETE: no hay par de comparación). */
  cambios: CambioAuditoriaDto[];
}

/** Página de la bitácora. */
export interface AuditoriaPageDto {
  entradas: EntradaAuditoriaDto[];
  total: number;
  pagina: number;
  paginas: number;
}

/** Fila cruda de `audit_log` con el email del actor resuelto. */
export interface AuditoriaFilaCruda {
  id: string;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by: string | null;
  actor_email: string | null;
  created_at: Date;
}

/** Claves SIEMPRE protegidas (hashes y PII cifrada; nunca en claro). */
const CLAVES_PROTEGIDAS = new Set(['cedula_hash', 'password_hash', 'telefono_cifrado']);

/** Marca sustituida en los valores protegidos del diff. */
export const VALOR_PROTEGIDO = '[PROTEGIDO]';

/**
 * ¿La clave contiene PII cifrada o un hash que NO debe salir ni siquiera en la
 * bitácora? Cualquier `*_cifrado(a)(s)` o `*_hash` entra (cédula, teléfono,
 * email si algún día se cifra, hashes de sesión...).
 */
export function esClaveProtegida(clave: string): boolean {
  const normalizada = clave.toLowerCase();
  return (
    CLAVES_PROTEGIDAS.has(normalizada) ||
    normalizada.endsWith('_hash') ||
    normalizada.endsWith('_cifrada') ||
    normalizada.endsWith('_cifradas') ||
    normalizada.endsWith('_cifrado')
  );
}

/**
 * Diff genérico campo a campo entre `old_data` y `new_data`. Los campos con el
 * MISMO valor en ambos lados no aparecen; los protegidos se comparan por
 * presencia pero su valor se sustituye por `[PROTEGIDO]`. En INSERT solo hay
 * `despues` (antes `undefined`); en DELETE solo `antes`.
 */
export function diffAuditoria(
  anterior: Record<string, unknown> | null,
  posterior: Record<string, unknown> | null,
): CambioAuditoriaDto[] {
  const claves = new Set([...Object.keys(anterior ?? {}), ...Object.keys(posterior ?? {})]);
  const cambios: CambioAuditoriaDto[] = [];
  for (const campo of [...claves].sort()) {
    const antes = anterior?.[campo];
    const despues = posterior?.[campo];
    if (Object.is(antes, despues)) continue;
    cambios.push({
      campo,
      antes: esClaveProtegida(campo) && antes !== undefined ? VALOR_PROTEGIDO : antes,
      despues: esClaveProtegida(campo) && despues !== undefined ? VALOR_PROTEGIDO : despues,
    });
  }
  return cambios;
}

/** Fila cruda → entrada pública (camelCase + diff enmascarado). */
export function toResponse(fila: AuditoriaFilaCruda): EntradaAuditoriaDto {
  return {
    id: fila.id,
    tabla: fila.table_name,
    registroId: fila.record_id,
    accion: fila.action,
    actor: { id: fila.changed_by, email: fila.actor_email },
    fecha: fila.created_at.toISOString(),
    cambios: diffAuditoria(fila.old_data, fila.new_data),
  };
}
