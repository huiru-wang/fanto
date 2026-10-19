import { sql, type Kysely } from "kysely";

/**
 * Remove the pre-V2 Pi Storage / snapshot structures without resetting the
 * migration ledger or deleting V2 Sessions. Existing history is intentionally
 * not migrated from the old unowned Session rows.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Old SDK storage and whole-session snapshot are no longer read or written.
  await sql`DROP TABLE IF EXISTS agent_session.snapshots`.execute(db);
  await sql`DROP TABLE IF EXISTS agent_session.scalar_values`.execute(db);
  await sql`DROP TABLE IF EXISTS agent_session.list_values`.execute(db);
  await sql`DROP TABLE IF EXISTS agent_session.branch_entries`.execute(db);
  await sql`DROP TABLE IF EXISTS agent_session.branch_meta`.execute(db);

  // Legacy sessions cannot be opened through the V2 user/agent-owned API.
  // Retain all valid V2 session IDs and their append-only transcript/usage.
  await sql`DELETE FROM agent_session.entries e WHERE NOT EXISTS
    (SELECT 1 FROM agent_session.sessions s WHERE s.id = e.session_id
       AND s.user_id IS NOT NULL AND s.agent_id IS NOT NULL)`.execute(db);
  await sql`DELETE FROM agent_session.usage_ledger u WHERE NOT EXISTS
    (SELECT 1 FROM agent_session.sessions s WHERE s.id = u.session_id
       AND s.user_id IS NOT NULL AND s.agent_id IS NOT NULL)`.execute(db);
  await sql`DELETE FROM agent_session.sessions
    WHERE user_id IS NULL OR agent_id IS NULL`.execute(db);

  await sql`DROP INDEX IF EXISTS agent_session.checkpoint_entries_user_run`.execute(db);
  await sql`DROP INDEX IF EXISTS agent_session.ix_entry_parent`.execute(db);
  await sql`DROP INDEX IF EXISTS agent_session.ix_entry_seq`.execute(db);
  // Historical Proposal Creation index references an obsolete JSON shape.
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

export async function down(): Promise<void> {
  throw new Error("Agent Storage cleanup is forward-only");
}
