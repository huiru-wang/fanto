import { sql, type Kysely } from "kysely";

/** Creates the only supported, current PostgreSQL schema on an empty database. */
export async function up(db: Kysely<any>) {
  await sql`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE users (user_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('active','disabled')), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, disabled_at TIMESTAMPTZ);\n    CREATE TABLE user_login_identities (identity_id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_subject TEXT NOT NULL, display_hint TEXT, verified_at TIMESTAMPTZ NOT NULL, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, CONSTRAINT user_login_identities_provider_subject UNIQUE(provider, provider_subject));\n    CREATE INDEX idx_user_login_identities_active_user ON user_login_identities(user_id) WHERE revoked_at IS NULL;\n    CREATE TABLE auth_challenges (challenge_id UUID PRIMARY KEY, purpose TEXT NOT NULL CHECK (purpose IN ('authenticate','register','login','bind','reauth')), provider TEXT NOT NULL, user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE, target_hash TEXT, nonce_hash TEXT, state_hash TEXT, verification_hash TEXT, context JSONB NOT NULL DEFAULT '{}'::jsonb, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL);\n    CREATE INDEX idx_auth_challenges_expires ON auth_challenges(expires_at) WHERE consumed_at IS NULL;
    CREATE TABLE records (id SERIAL PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, source TEXT NOT NULL, content TEXT NOT NULL, ext_data TEXT, version INTEGER NOT NULL, status TEXT NOT NULL, task_id TEXT, location_latitude DOUBLE PRECISION, location_longitude DOUBLE PRECISION, event_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CONSTRAINT records_location_coordinates_together CHECK ((location_latitude IS NULL) = (location_longitude IS NULL)), CONSTRAINT records_location_latitude_range CHECK (location_latitude IS NULL OR location_latitude BETWEEN -90 AND 90), CONSTRAINT records_location_longitude_range CHECK (location_longitude IS NULL OR location_longitude BETWEEN -180 AND 180));
    CREATE INDEX idx_records_user_event ON records(user_id, event_at, record_id);
    CREATE INDEX idx_records_map_lat ON records(user_id, location_latitude) WHERE location_latitude IS NOT NULL;
    CREATE INDEX idx_records_map_lon ON records(user_id, location_longitude) WHERE location_longitude IS NOT NULL;
    CREATE TABLE media_assets (id SERIAL PRIMARY KEY, media_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, object_key TEXT NOT NULL UNIQUE, media_type TEXT NOT NULL, mime_type TEXT NOT NULL, bytes INTEGER NOT NULL, status TEXT NOT NULL, ext_data TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX idx_media_assets_user_created ON media_assets(user_id, created_at);
    CREATE TABLE tasks (
      task_id UUID PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      goal JSONB NOT NULL,
      agent_id TEXT NOT NULL,
      timeout_seconds INTEGER NOT NULL,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('immediate','scheduled')),
      trigger JSONB NOT NULL,
      output JSONB NOT NULL DEFAULT '{}'::jsonb,
      ext_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL CHECK (status IN ('active','paused','completed','cancelled')),
      next_run_at TIMESTAMPTZ,
      source_session_id TEXT,
      source_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX idx_tasks_due ON tasks(status, next_run_at) WHERE next_run_at IS NOT NULL;
    CREATE INDEX idx_tasks_user_status_updated ON tasks(user_id, status, updated_at DESC, task_id DESC);
    CREATE TABLE task_runs (
      run_id UUID PRIMARY KEY,
      task_id UUID NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled')),
      scheduled_at TIMESTAMPTZ NOT NULL,
      worker_session_id TEXT,
      result_media_id TEXT REFERENCES media_assets(media_id),
      result JSONB,
      error JSONB,
      ext_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT uq_task_runs_task_scheduled_at UNIQUE(task_id, scheduled_at)
    );
    CREATE INDEX idx_task_runs_status_scheduled ON task_runs(status, scheduled_at ASC, created_at ASC);
    CREATE INDEX idx_task_runs_task_created ON task_runs(task_id, created_at DESC);
    CREATE INDEX idx_task_runs_user_created ON task_runs(user_id, created_at DESC);
    CREATE TABLE vector_items (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, type TEXT NOT NULL, outer_id TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT, event_at TEXT NOT NULL, indexed_at TEXT, created_at TEXT NOT NULL, embedding vector(768) NOT NULL);
    CREATE INDEX idx_vector_items_lookup ON vector_items(user_id, type, outer_id, status);
    CREATE TABLE projects (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id UUID NOT NULL UNIQUE, user_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('proposed','active','archived','rejected')), version INTEGER NOT NULL DEFAULT 1, ext_data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
    CREATE INDEX idx_projects_user_status_updated ON projects(user_id, status, updated_at DESC, project_id DESC);
    CREATE TABLE project_records (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id TEXT NOT NULL, project_id UUID NOT NULL, record_id TEXT NOT NULL, record_event_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, UNIQUE(user_id, project_id, record_id));
    CREATE INDEX idx_project_records_timeline ON project_records(user_id, project_id, record_event_at DESC, record_id DESC);
    CREATE INDEX idx_project_records_record ON project_records(user_id, record_id);
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`DROP TABLE IF EXISTS project_records; DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS vector_items; DROP TABLE IF EXISTS task_runs; DROP TABLE IF EXISTS tasks; DROP TABLE IF EXISTS media_assets; DROP TABLE IF EXISTS records; DROP TABLE IF EXISTS auth_challenges; DROP TABLE IF EXISTS user_login_identities; DROP TABLE IF EXISTS users;`.execute(db);
}
