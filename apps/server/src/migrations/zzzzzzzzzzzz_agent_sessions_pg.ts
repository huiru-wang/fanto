import { sql, type Kysely } from "kysely";

/**
 * Portable PostgreSQL version of pi-session-backend-sqlite-node@0.85.1/001_initial.sql.
 * No extensions, foreign keys, provider-specific APIs or user_id columns.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS agent_session`.execute(db);
  await sql`
    CREATE TABLE agent_session.sessions (
      id TEXT PRIMARY KEY,
      created_at BIGINT NOT NULL,
      parent_session_id TEXT,
      storage_version INTEGER NOT NULL,
      metadata JSONB,
      message_count BIGINT NOT NULL,
      usage_payload JSONB NOT NULL,
      next_seq BIGINT NOT NULL
    )
  `.execute(db);
  await sql`
    CREATE TABLE agent_session.entries (
      session_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT,
      seq BIGINT NOT NULL, type TEXT NOT NULL, custom_type TEXT,
      timestamp BIGINT NOT NULL, payload JSONB NOT NULL,
      PRIMARY KEY (session_id, id)
    )
  `.execute(db);
  await sql`CREATE INDEX ix_entry_parent ON agent_session.entries(session_id, parent_id)`.execute(db);
  await sql`CREATE INDEX ix_entry_seq ON agent_session.entries(session_id, seq, type)`.execute(db);
  await sql`
    CREATE TABLE agent_session.scalar_values (
      session_id TEXT NOT NULL, namespace TEXT NOT NULL, key TEXT NOT NULL,
      seq BIGINT NOT NULL, value JSONB NOT NULL,
      PRIMARY KEY (session_id, namespace, key)
    )
  `.execute(db);
  await sql`
    CREATE TABLE agent_session.list_values (
      session_id TEXT NOT NULL, namespace TEXT NOT NULL, key TEXT NOT NULL,
      seq BIGINT NOT NULL, value JSONB NOT NULL,
      PRIMARY KEY (session_id, namespace, key, seq)
    )
  `.execute(db);
  await sql`
    CREATE TABLE agent_session.usage_ledger (
      session_id TEXT NOT NULL, id TEXT NOT NULL, seq BIGINT NOT NULL,
      entry_id TEXT, adjustment BOOLEAN NOT NULL, usage JSONB NOT NULL, details JSONB,
      PRIMARY KEY (session_id, id)
    )
  `.execute(db);
  await sql`CREATE INDEX ix_usage_seq ON agent_session.usage_ledger(session_id, seq)`.execute(db);
  await sql`
    CREATE TABLE agent_session.branch_entries (
      session_id TEXT NOT NULL, branch_id TEXT NOT NULL, entry_id TEXT NOT NULL,
      entry_seq BIGINT NOT NULL, entry_type TEXT NOT NULL,
      PRIMARY KEY (session_id, branch_id, entry_id)
    )
  `.execute(db);
  await sql`CREATE INDEX ix_be_seq ON agent_session.branch_entries(session_id, branch_id, entry_seq, entry_id, entry_type)`.execute(db);
  await sql`CREATE INDEX ix_be_type ON agent_session.branch_entries(session_id, branch_id, entry_type, entry_seq, entry_id)`.execute(db);
  await sql`CREATE INDEX ix_be_entry ON agent_session.branch_entries(session_id, entry_id)`.execute(db);
  await sql`
    CREATE TABLE agent_session.branch_meta (
      session_id TEXT NOT NULL, branch_id TEXT NOT NULL, tip_entry_id TEXT NOT NULL,
      tip_seq BIGINT NOT NULL, base_branch_id TEXT, base_seq BIGINT,
      PRIMARY KEY (session_id, branch_id)
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX ix_bm_tip ON agent_session.branch_meta(session_id, tip_entry_id)`.execute(db);
}

/** Forward only: session data must never be removed by a migration rollback. */
export async function down(_db: Kysely<any>): Promise<void> {}
