import { sql, type Kysely } from "kysely";
export async function up(db:Kysely<any>) {
  await sql`ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check, DROP CONSTRAINT IF EXISTS projects_status_check1`.execute(db);
  await sql`UPDATE projects SET status = CASE WHEN length(trim(content))>0 THEN 'completed' ELSE 'failed' END WHERE status='active'`.execute(db);
  await sql`ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK(status IN ('queued','running','completed','failed','archived'))`.execute(db);
  await sql`ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'queued'`.execute(db);
  await sql`ALTER TABLE task_runs DROP CONSTRAINT IF EXISTS task_runs_status_check`.execute(db);
  await sql`ALTER TABLE task_runs ADD CONSTRAINT task_runs_status_check CHECK(status IN ('queued','running','completed','failed','cancelled'))`.execute(db);
  await sql`DROP TABLE IF EXISTS media_object_deletions`.execute(db);
}
export async function down(_db:Kysely<any>) { /* forward-only migration */ }
