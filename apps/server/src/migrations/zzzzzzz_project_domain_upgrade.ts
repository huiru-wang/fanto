import { sql, type Kysely } from "kysely";

/** Upgrade the executed legacy Project schema without deleting its source tables or user data. */
export async function up(db: Kysely<any>) {
  const legacy = await sql`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'projects' AND column_name = 'ext_data'`.execute(db);
  if (legacy.rows.length) {
    await sql`
      ALTER TABLE projects RENAME TO legacy_projects;
      ALTER INDEX IF EXISTS idx_projects_user_status_updated RENAME TO idx_legacy_projects_user_status_updated;
    `.execute(db);
  }
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      project_id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      session_id TEXT UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL, cover_media_id TEXT,
      content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
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
    CREATE INDEX IF NOT EXISTS idx_proposals_accepted_creation ON proposals(resolved_at, proposal_id)
      WHERE status = 'accepted' AND content->'creation' IS NOT NULL;
    CREATE TABLE IF NOT EXISTS record_links (
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, outer_id UUID NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('project','proposal')), record_id TEXT NOT NULL,
      record_event_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY(user_id, type, outer_id, record_id)
    );
    CREATE INDEX IF NOT EXISTS idx_record_links_timeline ON record_links(user_id, type, outer_id, record_event_at DESC, record_id DESC);
    CREATE INDEX IF NOT EXISTS idx_record_links_record ON record_links(user_id, record_id);
    ALTER TABLE proposals ADD COLUMN IF NOT EXISTS session_id TEXT;
    ALTER TABLE records ADD COLUMN IF NOT EXISTS embedding vector(768);
  `.execute(db);
  if (legacy.rows.length) {
    await sql`
      INSERT INTO projects (project_id, user_id, session_id, title, summary, cover_media_id, content, status, version, created_at, updated_at)
      SELECT p.project_id, p.user_id, NULL, p.title, COALESCE(NULLIF(trim(p.title), ''), '历史项目'), NULL, p.content, p.status, GREATEST(p.version, 1), p.created_at, p.updated_at
      FROM legacy_projects p JOIN users u ON u.user_id = p.user_id WHERE p.status IN ('active', 'archived');
      INSERT INTO proposals (proposal_id, user_id, session_id, type, target_project_id, title, proposed_summary, content, status, result_project_id, created_at, updated_at, resolved_at)
      SELECT p.project_id, p.user_id, NULL, 'create', NULL, p.title, COALESCE(NULLIF(trim(p.title), ''), '历史项目'),
        jsonb_build_object('reason', '历史提议', 'idea', p.title, 'plan', '[]'::jsonb),
        CASE WHEN p.status = 'proposed' THEN 'pending' ELSE 'rejected' END, NULL, p.created_at, p.updated_at,
        CASE WHEN p.status = 'rejected' THEN p.updated_at ELSE NULL END
      FROM legacy_projects p JOIN users u ON u.user_id = p.user_id WHERE p.status IN ('proposed', 'rejected');
    `.execute(db);
  }
  const links = await sql`SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'project_records'`.execute(db);
  if (links.rows.length) {
    await sql`
      INSERT INTO record_links (user_id, type, outer_id, record_id, record_event_at, created_at)
      SELECT l.user_id, 'project', l.project_id, l.record_id, l.record_event_at, l.created_at
      FROM project_records l JOIN projects p ON p.project_id = l.project_id AND p.user_id = l.user_id
      JOIN records r ON r.record_id = l.record_id AND r.user_id = l.user_id
      ON CONFLICT DO NOTHING;
      INSERT INTO record_links (user_id, type, outer_id, record_id, record_event_at, created_at)
      SELECT l.user_id, 'proposal', l.project_id, l.record_id, l.record_event_at, l.created_at
      FROM project_records l JOIN proposals p ON p.proposal_id = l.project_id AND p.user_id = l.user_id
      JOIN records r ON r.record_id = l.record_id AND r.user_id = l.user_id
      ON CONFLICT DO NOTHING;
      ALTER TABLE project_records RENAME TO legacy_project_records;
    `.execute(db);
  }
  await sql`
    UPDATE proposals p SET session_id = r.agent_session_id
    FROM proposal_runs r WHERE p.session_id IS NULL AND r.status = 'completed'
      AND r.proposal_id = p.proposal_id AND r.user_id = p.user_id AND r.agent_session_id IS NOT NULL;
  `.execute(db);
}

export async function down(_db: Kysely<any>) {
  throw new Error("Project domain upgrade cannot be rolled back automatically; legacy source tables are retained for recovery");
}
