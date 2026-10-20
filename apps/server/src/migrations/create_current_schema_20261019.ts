import { sql, type Kysely } from "kysely";
import { createAgentCheckpointSchema } from "../infrastructure/database/agent-schema.js";

/** Reset baseline: current schema only. Replaying creates missing objects without altering existing tables or data. */
export async function up(db: Kysely<any>) {
  await sql`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('active','disabled')), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, disabled_at TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS user_login_identities (identity_id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_subject TEXT NOT NULL, contact_value TEXT, display_hint TEXT, verified_at TIMESTAMPTZ NOT NULL, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, CONSTRAINT user_login_identities_provider_subject UNIQUE(provider, provider_subject));
    CREATE INDEX IF NOT EXISTS idx_user_login_identities_active_user ON user_login_identities(user_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS auth_challenges (challenge_id UUID PRIMARY KEY, purpose TEXT NOT NULL CHECK (purpose IN ('authenticate','register','login','bind','reauth')), provider TEXT NOT NULL, user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE, target_hash TEXT, nonce_hash TEXT, state_hash TEXT, verification_hash TEXT, context JSONB NOT NULL DEFAULT '{}'::jsonb, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expires_at) WHERE consumed_at IS NULL;
    CREATE TABLE IF NOT EXISTS records (id SERIAL PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, source TEXT NOT NULL, content TEXT NOT NULL, ext_data TEXT, version INTEGER NOT NULL, status TEXT NOT NULL, task_id TEXT, location_latitude DOUBLE PRECISION, location_longitude DOUBLE PRECISION, event_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, embedding vector(768), CONSTRAINT records_location_coordinates_together CHECK ((location_latitude IS NULL) = (location_longitude IS NULL)), CONSTRAINT records_location_latitude_range CHECK (location_latitude IS NULL OR location_latitude BETWEEN -90 AND 90), CONSTRAINT records_location_longitude_range CHECK (location_longitude IS NULL OR location_longitude BETWEEN -180 AND 180));
    CREATE INDEX IF NOT EXISTS idx_records_user_event ON records(user_id, event_at, record_id);
    CREATE INDEX IF NOT EXISTS idx_records_map_lat ON records(user_id, location_latitude) WHERE location_latitude IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_records_map_lon ON records(user_id, location_longitude) WHERE location_longitude IS NOT NULL;
    CREATE TABLE IF NOT EXISTS media_assets (id SERIAL PRIMARY KEY, media_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, object_key TEXT NOT NULL UNIQUE, media_type TEXT NOT NULL, mime_type TEXT NOT NULL, bytes INTEGER NOT NULL, status TEXT NOT NULL, ext_data TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_media_assets_user_created ON media_assets(user_id, created_at);
    CREATE TABLE IF NOT EXISTS memories (memory_id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('profile', 'goal', 'guidance', 'personal_background', 'important_relationships', 'current_focus', 'interaction_preferences', 'shared_history')), content TEXT NOT NULL, embedding vector(768) NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_memories_user_updated ON memories(user_id, updated_at DESC, memory_id DESC);
    CREATE TABLE IF NOT EXISTS projects (
      project_id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      session_id TEXT UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL, embedding vector(768), cover_media_id TEXT,
      goal JSONB NOT NULL DEFAULT '{}'::jsonb,
      content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','archived')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user_status_updated ON projects(user_id, status, updated_at DESC, project_id DESC);
    CREATE TABLE IF NOT EXISTS proposals (
      session_id TEXT,
      proposal_id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('create','extend')), target_project_id UUID,
      title TEXT NOT NULL, proposed_summary TEXT, content JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')), result_project_id UUID,
      created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, resolved_at TIMESTAMPTZ,
      CHECK((type = 'create' AND target_project_id IS NULL AND length(trim(proposed_summary)) > 0 AND proposed_summary IS NOT NULL)
        OR (type = 'extend' AND target_project_id IS NOT NULL AND proposed_summary IS NULL)),
      CHECK((status = 'pending' AND result_project_id IS NULL AND resolved_at IS NULL)
        OR (status = 'accepted' AND result_project_id IS NOT NULL AND resolved_at IS NOT NULL AND (type = 'create' OR result_project_id = target_project_id))
        OR (status = 'rejected' AND result_project_id IS NULL AND resolved_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_proposals_user_created ON proposals(user_id, created_at DESC, proposal_id DESC);
    CREATE INDEX IF NOT EXISTS idx_proposals_user_type_status_created ON proposals(user_id, type, status, created_at DESC, proposal_id DESC);
    CREATE INDEX IF NOT EXISTS idx_proposals_target_created ON proposals(user_id, target_project_id, created_at DESC, proposal_id DESC);
    CREATE TABLE IF NOT EXISTS record_links (
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, outer_id UUID NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('project','proposal')), record_id TEXT NOT NULL,
      record_event_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY(user_id, type, outer_id, record_id)
    );
    CREATE INDEX IF NOT EXISTS idx_record_links_timeline ON record_links(user_id, type, outer_id, record_event_at DESC, record_id DESC);
    CREATE INDEX IF NOT EXISTS idx_record_links_record ON record_links(user_id, record_id);
  `.execute(db);
  await sql`
    CREATE TABLE IF NOT EXISTS user_fanto_settings (
      fanto_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      nickname TEXT NOT NULL DEFAULT 'Fanto', description TEXT NOT NULL DEFAULT '',
      avatar_media_id TEXT REFERENCES media_assets(media_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
      role_config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(role_config) = 'object'),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), session_id TEXT
    );
    CREATE INDEX IF NOT EXISTS user_fanto_owner_created ON user_fanto_settings(user_id, created_at, fanto_id);
    CREATE INDEX IF NOT EXISTS user_fanto_avatar_reference ON user_fanto_settings(avatar_media_id) WHERE avatar_media_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      nickname TEXT NOT NULL DEFAULT '你', signature TEXT NOT NULL DEFAULT '',
      avatar_media_id TEXT REFERENCES media_assets(media_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cover_media_id TEXT REFERENCES media_assets(media_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX IF NOT EXISTS user_profile_avatar_reference ON user_profiles(avatar_media_id) WHERE avatar_media_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS user_profile_cover_reference ON user_profiles(cover_media_id) WHERE cover_media_id IS NOT NULL;
  `.execute(db);
  await createAgentCheckpointSchema(db);
}

export async function down(_db: Kysely<any>) { /* Forward only. */ }
