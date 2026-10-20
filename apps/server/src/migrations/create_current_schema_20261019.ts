import { sql, type Kysely } from "kysely";
import { createAgentCheckpointSchema } from "../infrastructure/database/agent-schema.js";

/** Single fresh-database baseline: all current business and checkpoint tables, without foreign keys.
 * Replaying creates missing objects without altering existing tables or deleting data.
 */
export async function up(db: Kysely<any>) {
  await sql`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('active','disabled')), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, disabled_at TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS user_login_identities (identity_id UUID PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, provider_subject TEXT NOT NULL, contact_value TEXT, display_hint TEXT, verified_at TIMESTAMPTZ NOT NULL, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, CONSTRAINT user_login_identities_provider_subject UNIQUE(provider, provider_subject));
    CREATE INDEX IF NOT EXISTS idx_user_login_identities_active_user ON user_login_identities(user_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS auth_challenges (challenge_id UUID PRIMARY KEY, purpose TEXT NOT NULL CHECK (purpose IN ('authenticate','register','login','bind','reauth')), provider TEXT NOT NULL, user_id TEXT, target_hash TEXT, nonce_hash TEXT, state_hash TEXT, verification_hash TEXT, context JSONB NOT NULL DEFAULT '{}'::jsonb, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expires_at) WHERE consumed_at IS NULL;
    CREATE TABLE IF NOT EXISTS records (id SERIAL PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, owner_type TEXT NOT NULL CHECK(owner_type IN ('user','fanto')), owner_id TEXT NOT NULL, source TEXT NOT NULL, content TEXT NOT NULL, ext_data TEXT, version INTEGER NOT NULL, status TEXT NOT NULL, task_id TEXT, location_latitude DOUBLE PRECISION, location_longitude DOUBLE PRECISION, event_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, embedding vector(768), CONSTRAINT records_location_coordinates_together CHECK ((location_latitude IS NULL) = (location_longitude IS NULL)), CONSTRAINT records_location_latitude_range CHECK (location_latitude IS NULL OR location_latitude BETWEEN -90 AND 90), CONSTRAINT records_location_longitude_range CHECK (location_longitude IS NULL OR location_longitude BETWEEN -180 AND 180));
    CREATE INDEX IF NOT EXISTS idx_records_user_event ON records(owner_type, owner_id, event_at, record_id);
    CREATE INDEX IF NOT EXISTS idx_records_map_lat ON records(owner_type, owner_id, location_latitude) WHERE location_latitude IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_records_map_lon ON records(owner_type, owner_id, location_longitude) WHERE location_longitude IS NOT NULL;
    CREATE TABLE IF NOT EXISTS media_assets (id SERIAL PRIMARY KEY, media_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, media_type TEXT NOT NULL, mime_type TEXT NOT NULL, bytes INTEGER NOT NULL, status TEXT NOT NULL, ext_data TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_media_assets_user_created ON media_assets(user_id, created_at);
    CREATE TABLE IF NOT EXISTS memories (memory_id UUID PRIMARY KEY, owner_type TEXT NOT NULL CHECK(owner_type IN ('user','fanto')), owner_id TEXT NOT NULL, kind TEXT NOT NULL, CHECK ((owner_type='user' AND kind IN ('personal_background','important_relationships','current_focus','interaction_preferences')) OR (owner_type='fanto' AND kind IN ('shared_history','relationship_state','ongoing_threads','personal_experiences'))), content TEXT NOT NULL, embedding vector(768) NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_memories_user_updated ON memories(owner_type, owner_id, updated_at DESC, memory_id DESC);
  `.execute(db);
  await sql`
    CREATE TABLE IF NOT EXISTS user_fantos (
      fanto_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      nickname TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      avatar_media_id TEXT,
      role_config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(role_config) = 'object'),
      agent_config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(agent_config) = 'object'),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), archived_at TIMESTAMPTZ,
      CHECK ((status='archived') = (archived_at IS NOT NULL)),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_fanto_owner_created ON user_fantos(user_id, created_at, fanto_id);
    CREATE INDEX IF NOT EXISTS user_fanto_active_owner ON user_fantos(user_id, status);
    CREATE TABLE IF NOT EXISTS fanto_media_deletions (
      fanto_id UUID PRIMARY KEY, user_id TEXT NOT NULL, object_keys JSONB NOT NULL CHECK(jsonb_typeof(object_keys)='array')
    );
    CREATE INDEX IF NOT EXISTS user_fanto_avatar_reference ON user_fantos(avatar_media_id) WHERE avatar_media_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL DEFAULT '你', signature TEXT NOT NULL DEFAULT '',
      avatar_media_id TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cover_media_id TEXT
    );
    CREATE INDEX IF NOT EXISTS user_profile_avatar_reference ON user_profiles(avatar_media_id) WHERE avatar_media_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS user_profile_cover_reference ON user_profiles(cover_media_id) WHERE cover_media_id IS NOT NULL;
  `.execute(db);
  await createAgentCheckpointSchema(db);
}

export async function down(_db: Kysely<any>) { /* Forward only. */ }
