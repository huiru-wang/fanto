import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`CREATE TABLE auth_sessions (
    session_id UUID PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    client_type TEXT NOT NULL CHECK (client_type IN ('web', 'native')),
    created_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    idle_expires_at TIMESTAMPTZ NOT NULL,
    absolute_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT auth_session_time CHECK (idle_expires_at <= absolute_expires_at)
  )`.execute(db);
  await sql`CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id)`.execute(db);
  await sql`CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(absolute_expires_at, idle_expires_at)`.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`DROP TABLE auth_sessions`.execute(db);
}
