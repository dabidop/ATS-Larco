import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 015 — historial de tokens de refresh para rotación atómica.
 *
 * Cada token solo puede consumirse una vez. Si se vuelve a presentar un token
 * ya usado, la aplicación revoca toda la sesión (detección de reutilización).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE auth_session_refresh_tokens (
      id uuid PRIMARY KEY,
      session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      issued_at timestamptz NOT NULL DEFAULT now(),
      used_at timestamptz,
      replaced_by_hash text,
      CONSTRAINT auth_session_refresh_tokens_replacement_check CHECK (
        (used_at IS NULL AND replaced_by_hash IS NULL)
        OR (used_at IS NOT NULL AND replaced_by_hash IS NOT NULL)
      )
    );

    CREATE INDEX auth_session_refresh_tokens_session_idx
      ON auth_session_refresh_tokens (session_id, issued_at DESC);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS auth_session_refresh_tokens;');
}
