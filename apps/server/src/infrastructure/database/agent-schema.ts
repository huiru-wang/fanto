import { sql, type Kysely } from "kysely";

/** Current append-only checkpoint schema. No Pi SDK storage or snapshot tables. */
export async function createAgentCheckpointSchema(db: Kysely<any>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS agent_session`.execute(db);
  await sql`CREATE TABLE IF NOT EXISTS agent_session.sessions (
    id TEXT PRIMARY KEY, created_at BIGINT NOT NULL, next_seq BIGINT NOT NULL,
    user_id TEXT NOT NULL, agent_id TEXT NOT NULL, title TEXT,
    tip_entry_id TEXT, updated_at BIGINT NOT NULL
  )`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS checkpoint_sessions_user
    ON agent_session.sessions(user_id, agent_id, updated_at DESC, id DESC)`.execute(db);
  await sql`CREATE TABLE IF NOT EXISTS agent_session.entries (
    session_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT,
    seq BIGINT NOT NULL, type TEXT NOT NULL, custom_type TEXT,
    timestamp BIGINT NOT NULL, payload JSONB NOT NULL, run_id TEXT,
    PRIMARY KEY (session_id, id)
  )`.execute(db);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_entries_seq ON agent_session.entries(session_id, seq)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS checkpoint_entries_run ON agent_session.entries(session_id, run_id, seq)
    WHERE run_id IS NOT NULL`.execute(db);
  await sql`CREATE TABLE IF NOT EXISTS agent_session.usage_ledger (
    session_id TEXT NOT NULL, id TEXT NOT NULL, seq BIGINT NOT NULL,
    entry_id TEXT, adjustment BOOLEAN NOT NULL, usage JSONB NOT NULL,
    details JSONB, run_id TEXT, created_at BIGINT, provider TEXT, model TEXT,
    PRIMARY KEY (session_id, id)
  )`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS ix_usage_seq ON agent_session.usage_ledger(session_id, seq)`.execute(db);
}
