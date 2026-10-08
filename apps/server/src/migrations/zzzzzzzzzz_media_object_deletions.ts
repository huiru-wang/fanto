import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`CREATE TABLE media_object_deletions (
    object_key TEXT PRIMARY KEY, user_id TEXT NOT NULL, media_id TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  ); CREATE INDEX media_object_deletions_due ON media_object_deletions (next_attempt_at);`.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`DROP TABLE media_object_deletions`.execute(db);
}
