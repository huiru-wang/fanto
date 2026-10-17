import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`CREATE TABLE agent_session.snapshots (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    revision BIGINT NOT NULL,
    snapshot JSONB NOT NULL
  )`.execute(db);
}
export async function down(db: Kysely<any>) {
  await sql`DROP TABLE agent_session.snapshots`.execute(db);
}
