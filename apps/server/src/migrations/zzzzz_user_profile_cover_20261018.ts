import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`ALTER TABLE user_profiles ADD COLUMN cover_media_id TEXT REFERENCES media_assets(media_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`.execute(db);
  await sql`CREATE INDEX user_profile_cover_reference ON user_profiles(cover_media_id) WHERE cover_media_id IS NOT NULL`.execute(db);
}
export async function down(db: Kysely<any>) { await sql`ALTER TABLE user_profiles DROP COLUMN cover_media_id`.execute(db); }
