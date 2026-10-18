import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`CREATE TABLE user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    nickname TEXT NOT NULL DEFAULT '你', signature TEXT NOT NULL DEFAULT '',
    avatar_media_id TEXT REFERENCES media_assets(media_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`.execute(db);
  await sql`CREATE INDEX user_profile_avatar_reference ON user_profiles(avatar_media_id) WHERE avatar_media_id IS NOT NULL`.execute(db);
}
export async function down(db: Kysely<any>) { await sql`DROP TABLE user_profiles`.execute(db); }
