import { sql, type Kysely } from "kysely";

/** Creates the only supported, current PostgreSQL schema on an empty database. */
export async function up(db: Kysely<any>) {
  await sql`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE users (user_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('active','disabled')), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, disabled_at TIMESTAMPTZ);\n    CREATE TABLE user_login_identities (identity_id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_subject TEXT NOT NULL, display_hint TEXT, verified_at TIMESTAMPTZ NOT NULL, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, CONSTRAINT user_login_identities_provider_subject UNIQUE(provider, provider_subject));\n    CREATE INDEX idx_user_login_identities_active_user ON user_login_identities(user_id) WHERE revoked_at IS NULL;\n    CREATE TABLE auth_challenges (challenge_id UUID PRIMARY KEY, purpose TEXT NOT NULL CHECK (purpose IN ('register','login','bind','reauth')), provider TEXT NOT NULL, user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE, target_hash TEXT, nonce_hash TEXT, state_hash TEXT, verification_hash TEXT, context JSONB NOT NULL DEFAULT '{}'::jsonb, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL);\n    CREATE INDEX idx_auth_challenges_expires ON auth_challenges(expires_at) WHERE consumed_at IS NULL;
    CREATE TABLE records (id SERIAL PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, source TEXT NOT NULL, content TEXT NOT NULL, ext_data TEXT, version INTEGER NOT NULL, status TEXT NOT NULL, task_id TEXT, event_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX idx_records_user_event ON records(user_id, event_at, record_id);
    CREATE TABLE user_preferences (id SERIAL PRIMARY KEY, preference_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, category TEXT NOT NULL, content TEXT NOT NULL, source_session_id TEXT NOT NULL, source_message_id TEXT NOT NULL, source_quote TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX idx_user_preferences_user_updated ON user_preferences(user_id, updated_at, preference_id);
    CREATE INDEX idx_user_preferences_user_category_content ON user_preferences(user_id, category, content);
    CREATE TABLE media_assets (id SERIAL PRIMARY KEY, media_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, object_key TEXT NOT NULL UNIQUE, media_type TEXT NOT NULL, mime_type TEXT NOT NULL, bytes INTEGER NOT NULL, status TEXT NOT NULL, ext_data TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX idx_media_assets_user_created ON media_assets(user_id, created_at);
    CREATE TABLE vector_items (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, type TEXT NOT NULL, outer_id TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT, event_at TEXT NOT NULL, indexed_at TEXT, created_at TEXT NOT NULL, embedding vector(768) NOT NULL);
    CREATE INDEX idx_vector_items_lookup ON vector_items(user_id, type, outer_id, status);
    CREATE TABLE creation_kinds (kind_id TEXT PRIMARY KEY, owner_user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE, name TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE creations (id SERIAL PRIMARY KEY, creation_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, title TEXT NOT NULL, kind_id TEXT NOT NULL, session_id TEXT NOT NULL, summary TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE creation_proposals (id SERIAL PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, creation_id TEXT, base_creation_version INTEGER, operation TEXT NOT NULL, session_id TEXT NOT NULL, title TEXT, kind_id TEXT, summary TEXT, content TEXT, ext_data TEXT, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE entity_relations (relation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, source_entity_id TEXT NOT NULL, source_entity_type TEXT NOT NULL, target_entity_id TEXT NOT NULL, target_entity_type TEXT NOT NULL, relation_type TEXT NOT NULL, source_created_at TEXT NOT NULL, created_at TEXT NOT NULL, CONSTRAINT entity_relations_unique UNIQUE(user_id, source_entity_id, target_entity_id, relation_type));
    CREATE INDEX idx_entity_relations_target_records ON entity_relations(user_id, target_entity_type, target_entity_id, relation_type, source_created_at DESC, source_entity_id DESC);
    CREATE INDEX idx_entity_relations_source ON entity_relations(user_id, source_entity_type, source_entity_id, relation_type, target_entity_type, target_entity_id);
    CREATE INDEX idx_creations_user_status_updated ON creations(user_id, status, updated_at DESC, creation_id DESC);
    CREATE INDEX idx_creations_user_kind_status_updated ON creations(user_id, kind_id, status, updated_at DESC, creation_id DESC);
    CREATE INDEX idx_creation_proposals_user_status_updated ON creation_proposals(user_id, status, updated_at DESC, proposal_id DESC);
    CREATE UNIQUE INDEX idx_creation_kinds_system_name ON creation_kinds(name) WHERE owner_user_id IS NULL;
    CREATE UNIQUE INDEX idx_creation_kinds_user_name ON creation_kinds(owner_user_id, name) WHERE owner_user_id IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`DROP TABLE IF EXISTS entity_relations; DROP TABLE IF EXISTS creation_proposals; DROP TABLE IF EXISTS creations; DROP TABLE IF EXISTS creation_kinds; DROP TABLE IF EXISTS vector_items; DROP TABLE IF EXISTS media_assets; DROP TABLE IF EXISTS user_preferences; DROP TABLE IF EXISTS records; DROP TABLE IF EXISTS auth_challenges; DROP TABLE IF EXISTS user_login_identities; DROP TABLE IF EXISTS users;`.execute(db);
}
