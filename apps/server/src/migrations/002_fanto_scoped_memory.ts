import { sql, type Kysely } from "kysely";

/**
 * Upgrade from 001 to Fanto-owned, kindless long-term memory.
 *
 * Historical user/character memories and `scope_key='default'` sessions are NOT
 * reassigned or copied to the new identities. The legacy memory table is kept
 * under an archival name so this upgrade does not silently destroy user data.
 * Legacy default sessions keep their history; new sessions must use a UUID.
 *
 * Some older users may have blank/duplicate nicknames. This migration must
 * not rewrite their identities. A database trigger enforces the current naming
 * contract for all NEW roles/renames without rejecting historical rows.
 */
export async function up(db: Kysely<any>) {
  // The prior AgentConfig JSON contains userMemoryEnabled, but the new runtime
  // validates this object strictly. Normalize only this configuration schema;
  // never copy historical messages or user memories into role memory.
  await sql`UPDATE user_fantos
    SET agent_config = (agent_config - 'userMemoryEnabled') || '{"fantoMemoryEnabled":true}'::jsonb,
        version = version + 1, updated_at = now()
    WHERE agent_config ? 'userMemoryEnabled'
       OR agent_config->>'fantoMemoryEnabled' IS DISTINCT FROM 'true'`.execute(db);

  await sql`ALTER TABLE user_fantos ALTER COLUMN nickname DROP DEFAULT`.execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION enforce_fanto_nickname_002() RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' OR NEW.nickname IS DISTINCT FROM OLD.nickname THEN
        IF length(btrim(NEW.nickname)) NOT BETWEEN 1 AND 30 OR NEW.nickname <> btrim(NEW.nickname) THEN
          RAISE EXCEPTION 'FANTO_NAME_INVALID' USING ERRCODE = '23514';
        END IF;
        -- Cross-request serialization for direct SQL callers, not just FantoService.
        PERFORM 1 FROM users WHERE user_id = NEW.user_id FOR UPDATE;
        IF EXISTS (
          SELECT 1 FROM user_fantos
          WHERE user_id = NEW.user_id AND lower(nickname) = lower(NEW.nickname)
            AND fanto_id <> NEW.fanto_id
        ) THEN
          RAISE EXCEPTION 'FANTO_NAME_TAKEN' USING ERRCODE = '23505';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql
  `.execute(db);
  await sql`DROP TRIGGER IF EXISTS user_fanto_nickname_guard_002 ON user_fantos`.execute(db);
  await sql`CREATE TRIGGER user_fanto_nickname_guard_002
    BEFORE INSERT OR UPDATE OF nickname ON user_fantos
    FOR EACH ROW EXECUTE FUNCTION enforce_fanto_nickname_002()`.execute(db);

  // When historical non-empty nicknames are already unique, keep a fast
  // declarative unique index. Otherwise, the trigger protects future writes
  // without altering existing duplicate identities.
  const duplicates = await sql<{ user_id: string }>`
    SELECT user_id FROM user_fantos WHERE btrim(nickname) <> ''
    GROUP BY user_id, lower(nickname) HAVING count(*) > 1 LIMIT 1
  `.execute(db);
  if (duplicates.rows.length === 0) {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS user_fanto_unique_nickname
      ON user_fantos(user_id, lower(nickname)) WHERE btrim(nickname) <> ''`.execute(db);
  }

  const columns = await sql<{ column_name: string }>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='memories'
  `.execute(db);
  if (columns.rows.some(row => row.column_name === "owner_type")) {
    const archive = await sql<{exists:boolean}>`
      SELECT to_regclass('public.memories_legacy_002') IS NOT NULL AS exists
    `.execute(db);
    if (archive.rows[0]?.exists) throw new Error("Legacy memory archive already exists; aborting to avoid data loss");
    await sql`ALTER TABLE public.memories RENAME TO memories_legacy_002`.execute(db);
  } else if (columns.rows.length && !columns.rows.some(row => row.column_name === "fanto_id")) {
    throw new Error("Unknown memories schema; refusing destructive migration");
  }
  await sql`CREATE TABLE IF NOT EXISTS memories (
    memory_id UUID PRIMARY KEY, fanto_id UUID NOT NULL,
    content TEXT NOT NULL, embedding vector(768) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
  )`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_memories_fanto_updated
    ON memories(fanto_id, updated_at DESC, memory_id DESC)`.execute(db);

  await sql`ALTER TABLE agent_session.sessions ALTER COLUMN scope_key DROP DEFAULT`.execute(db);
  await sql`ALTER TABLE agent_session.sessions DROP CONSTRAINT IF EXISTS sessions_scope_key_check`.execute(db);
  // NOT VALID does not rewrite or drop existing 'default' sessions. It rejects
  // new invalid scopes immediately; new Main sessions must use a Fanto UUID.
  await sql`ALTER TABLE agent_session.sessions ADD CONSTRAINT sessions_scope_key_check
    CHECK (scope_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') NOT VALID`.execute(db);
}

export async function down(_db: Kysely<any>) { /* Forward-only: archival data must never be dropped on rollback. */ }
