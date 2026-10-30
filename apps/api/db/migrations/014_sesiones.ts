import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * 014 — sesiones revocables.
 *
 * Los tokens de refresh nunca se almacenan en claro: solo se guarda su
 * SHA-256. La sesión permanece protegida por cookies HttpOnly, rotación y
 * revocación en servidor.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE auth_sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_hash text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      user_agent text,
      ip_address inet,
      CONSTRAINT auth_sessions_expiry_check CHECK (expires_at > created_at)
    );

    CREATE INDEX auth_sessions_user_active_idx
      ON auth_sessions (user_id, expires_at)
      WHERE revoked_at IS NULL;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS auth_sessions;');
}
