import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
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
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, next_run_at) WHERE next_run_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_user_status_updated ON tasks(user_id, status, updated_at DESC, task_id DESC);

    CREATE TABLE IF NOT EXISTS task_runs (
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
    CREATE INDEX IF NOT EXISTS idx_task_runs_status_scheduled ON task_runs(status, scheduled_at ASC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_task_runs_task_created ON task_runs(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_runs_user_created ON task_runs(user_id, created_at DESC);
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`DROP TABLE IF EXISTS task_runs; DROP TABLE IF EXISTS tasks;`.execute(db);
}
