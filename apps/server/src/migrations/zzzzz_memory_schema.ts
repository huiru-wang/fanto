import { sql, type Kysely } from "kysely";

/** Adds the user-owned, vector-searchable Fanto memory store. */
export async function up(db: Kysely<any>) {
  await sql`
    CREATE TABLE IF NOT EXISTS memories (
      memory_id UUID PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('profile', 'goal', 'guidance')),
      content TEXT NOT NULL,
      embedding vector(768) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_user_updated
      ON memories(user_id, updated_at DESC, memory_id DESC);
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`DROP TABLE IF EXISTS memories;`.execute(db);
}
