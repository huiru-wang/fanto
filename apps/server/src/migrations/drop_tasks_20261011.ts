import { sql, type Kysely } from "kysely";

// Intentionally discard legacy Task/TaskRun data.
export async function up(db: Kysely<any>) {
  await sql`DROP TABLE IF EXISTS task_runs`.execute(db);
  await sql`DROP TABLE IF EXISTS tasks`.execute(db);
}
export async function down(_db: Kysely<any>) { /* Forward only. */ }
