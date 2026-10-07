import { sql, type Kysely } from "kysely";
/** Agent execution data; business facts remain in Proposal / Project. */
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE proposal_runs (
      run_id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      record_id TEXT NOT NULL, record_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
      proposal_id UUID, outcome JSONB, read_record_ids JSONB NOT NULL DEFAULT '[]',
      agent_session_id TEXT, lease_token UUID, lease_expires_at TIMESTAMPTZ,
      attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE(user_id, record_id, record_version)
    );
    CREATE INDEX idx_proposal_runs_due ON proposal_runs(status, created_at, run_id);
    CREATE TABLE creation_runs (
      run_id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      proposal_id UUID NOT NULL UNIQUE, project_id UUID NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
      base_project_version INTEGER, agent_session_id TEXT, lease_token UUID, lease_expires_at TIMESTAMPTZ,
      progress JSONB NOT NULL DEFAULT '{}', published_project_version INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT,
      accepted_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX idx_creation_runs_due ON creation_runs(status, accepted_at, proposal_id);
    CREATE INDEX idx_creation_runs_project ON creation_runs(user_id, project_id, accepted_at DESC, proposal_id DESC);
    CREATE UNIQUE INDEX idx_creation_runs_one_running ON creation_runs(project_id) WHERE status = 'running';
    CREATE TABLE creation_image_steps (
      run_id UUID NOT NULL REFERENCES creation_runs(run_id) ON DELETE CASCADE, image_index INTEGER NOT NULL CHECK(image_index BETWEEN 1 AND 3),
      fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('requested','response','saved','failed','unknown')),
      media_id TEXT NOT NULL, metadata JSONB, recovery_ciphertext TEXT, recovery_expires_at TIMESTAMPTZ, error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY(run_id, image_index)
    );
  `.execute(db);
}
export async function down(db: Kysely<any>) {
  await sql`DROP TABLE IF EXISTS creation_image_steps; DROP TABLE IF EXISTS creation_runs; DROP TABLE IF EXISTS proposal_runs;`.execute(db);
}
