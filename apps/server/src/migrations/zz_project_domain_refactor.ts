import { sql, type Kysely } from "kysely";

/** Replace the unused Creation/Proposal schema with the Project domain. No legacy data is migrated. */
export async function up(db: Kysely<any>) {
  await sql`
    DROP TABLE IF EXISTS entity_relations;
    DROP TABLE IF EXISTS creation_proposals;
    DROP TABLE IF EXISTS creations;
    DROP TABLE IF EXISTS creation_kinds;

    CREATE TABLE IF NOT EXISTS projects (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id UUID NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('proposed','active','archived','rejected')),
      version INTEGER NOT NULL DEFAULT 1,
      ext_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user_status_updated
      ON projects(user_id, status, updated_at DESC, project_id DESC);

    CREATE TABLE IF NOT EXISTS project_records (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id UUID NOT NULL,
      record_id TEXT NOT NULL,
      record_event_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE(user_id, project_id, record_id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_records_timeline
      ON project_records(user_id, project_id, record_event_at DESC, record_id DESC);
    CREATE INDEX IF NOT EXISTS idx_project_records_record
      ON project_records(user_id, record_id);
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`
    DROP TABLE IF EXISTS project_records;
    DROP TABLE IF EXISTS projects;
  `.execute(db);
}
