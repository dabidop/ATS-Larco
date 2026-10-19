/**
 * Punto de entrada compartido entre frontend y backend.
 *
 * En la Fase 0 solo expone un símbolo trivial para validar que el paquete
 * `@ats/shared` resuelve correctamente desde `apps/api` (CommonJS) y desde
 * `apps/web` (ESM/Vite). Los tipos de dominio y schemas Zod se agregan en
 * la Fase 1.
 */

/** Etiqueta de verificación de salud usada por el stub de UI. */
export function healthcheckLabel(): string {
  return 'api: desconectado';
}

export const SHARED_PACKAGE = '@ats/shared';
