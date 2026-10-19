import { sql, type Kysely } from "kysely";

/** V2 checkpoint schema. Historical snapshot/SDK storage rows are deliberately not migrated. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE agent_session.sessions
    ADD COLUMN IF NOT EXISTS user_id TEXT,
    ADD COLUMN IF NOT EXISTS agent_id TEXT,
    ADD COLUMN IF NOT EXISTS title TEXT,
    ADD COLUMN IF NOT EXISTS tip_entry_id TEXT,
    ADD COLUMN IF NOT EXISTS updated_at BIGINT`.execute(db);
  await sql`ALTER TABLE agent_session.entries
    ADD COLUMN IF NOT EXISTS run_id TEXT,
    ADD COLUMN IF NOT EXISTS role TEXT`.execute(db);
  await sql`ALTER TABLE agent_session.usage_ledger
    ADD COLUMN IF NOT EXISTS run_id TEXT,
    ADD COLUMN IF NOT EXISTS provider TEXT,
    ADD COLUMN IF NOT EXISTS model TEXT,
    ADD COLUMN IF NOT EXISTS created_at BIGINT`.execute(db);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_entries_seq
    ON agent_session.entries(session_id, seq)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS checkpoint_entries_run
    ON agent_session.entries(session_id, run_id, seq) WHERE run_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS checkpoint_entries_user_run
    ON agent_session.entries(session_id, seq) WHERE role = 'user' AND run_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS checkpoint_sessions_user
    ON agent_session.sessions(user_id, agent_id, updated_at DESC, id DESC)`.execute(db);
  await sql`ALTER TABLE user_fanto_settings ADD COLUMN IF NOT EXISTS main_session_id TEXT`.execute(db);
}
export async function down(): Promise<void> {
  throw new Error("Checkpoint migration is forward-only");
}
