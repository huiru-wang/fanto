import { sql, type Kysely } from "kysely";

/** Current append-only checkpoint schema. No Pi SDK storage or snapshot tables. */
export async function createAgentCheckpointSchema(db: Kysely<any>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS agent_session`.execute(db);
  await sql`CREATE TABLE agent_session.sessions (
    id TEXT PRIMARY KEY, created_at BIGINT NOT NULL, next_seq BIGINT NOT NULL,
    user_id TEXT NOT NULL, agent_id TEXT NOT NULL, title TEXT,
    tip_entry_id TEXT, updated_at BIGINT NOT NULL
  )`.execute(db);
  await sql`CREATE INDEX checkpoint_sessions_user
    ON agent_session.sessions(user_id, agent_id, updated_at DESC, id DESC)`.execute(db);
  await sql`CREATE TABLE agent_session.entries (
    session_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT,
    seq BIGINT NOT NULL, type TEXT NOT NULL, custom_type TEXT,
    timestamp BIGINT NOT NULL, payload JSONB NOT NULL, run_id TEXT,
    PRIMARY KEY (session_id, id)
  )`.execute(db);
  await sql`CREATE UNIQUE INDEX checkpoint_entries_seq ON agent_session.entries(session_id, seq)`.execute(db);
  await sql`CREATE INDEX checkpoint_entries_run ON agent_session.entries(session_id, run_id, seq)
    WHERE run_id IS NOT NULL`.execute(db);
  await sql`CREATE TABLE agent_session.usage_ledger (
    session_id TEXT NOT NULL, id TEXT NOT NULL, seq BIGINT NOT NULL,
    entry_id TEXT, adjustment BOOLEAN NOT NULL, usage JSONB NOT NULL,
    details JSONB, run_id TEXT, created_at BIGINT, provider TEXT, model TEXT,
    PRIMARY KEY (session_id, id)
  )`.execute(db);
  await sql`CREATE INDEX ix_usage_seq ON agent_session.usage_ledger(session_id, seq)`.execute(db);
}

/** Apply the last pre-squash upgrade only when its migration was not recorded. */
export async function finishLegacyAgentUpgrade(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS agent_session.snapshots`.execute(db);
  await sql`DROP TABLE IF EXISTS agent_session.scalar_values`.execute(db);
  await sql`DROP TABLE IF EXISTS agent_session.list_values`.execute(db);
  await sql`DROP TABLE IF EXISTS agent_session.branch_entries`.execute(db);
  await sql`DROP TABLE IF EXISTS agent_session.branch_meta`.execute(db);
  await sql`DELETE FROM agent_session.entries e WHERE NOT EXISTS
    (SELECT 1 FROM agent_session.sessions s WHERE s.id = e.session_id
       AND s.user_id IS NOT NULL AND s.agent_id IS NOT NULL)`.execute(db);
  await sql`DELETE FROM agent_session.usage_ledger u WHERE NOT EXISTS
    (SELECT 1 FROM agent_session.sessions s WHERE s.id = u.session_id
       AND s.user_id IS NOT NULL AND s.agent_id IS NOT NULL)`.execute(db);
  await sql`DELETE FROM agent_session.sessions WHERE user_id IS NULL OR agent_id IS NULL`.execute(db);
  await sql`DROP INDEX IF EXISTS agent_session.checkpoint_entries_user_run`.execute(db);
  await sql`DROP INDEX IF EXISTS agent_session.ix_entry_parent`.execute(db);
  await sql`DROP INDEX IF EXISTS agent_session.ix_entry_seq`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_proposals_accepted_creation`.execute(db);
  await sql`ALTER TABLE agent_session.entries DROP COLUMN IF EXISTS role`.execute(db);
  await sql`ALTER TABLE agent_session.sessions
    DROP COLUMN IF EXISTS parent_session_id,
    DROP COLUMN IF EXISTS storage_version,
    DROP COLUMN IF EXISTS metadata,
    DROP COLUMN IF EXISTS message_count,
    DROP COLUMN IF EXISTS usage_payload`.execute(db);
  await sql`ALTER TABLE agent_session.sessions
    ALTER COLUMN user_id SET NOT NULL,
    ALTER COLUMN agent_id SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL`.execute(db);
}
