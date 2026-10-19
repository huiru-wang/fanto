import { sql, type Kysely } from "kysely";

/** Identity is independent of the owner. Product APIs still expose only the first Fanto. */
export async function up(db: Kysely<any>) {
  await sql`
    ALTER TABLE user_fanto_settings ADD COLUMN fanto_id UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE user_fanto_settings DROP CONSTRAINT user_fanto_settings_pkey;
    ALTER TABLE user_fanto_settings ADD PRIMARY KEY (fanto_id);
    ALTER TABLE user_fanto_settings RENAME COLUMN main_session_id TO session_id;
    CREATE INDEX user_fanto_owner_created ON user_fanto_settings(user_id, created_at, fanto_id);
  `.execute(db);
}
export async function down(_db: Kysely<any>) { /* Forward only. */ }
