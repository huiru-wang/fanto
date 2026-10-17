import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`CREATE TABLE user_character (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    character TEXT NOT NULL DEFAULT '',
    scenario TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    example_dialogues TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`DROP TABLE user_character`.execute(db);
}
