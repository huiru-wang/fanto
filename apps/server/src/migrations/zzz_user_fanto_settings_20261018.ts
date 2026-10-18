import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<any>) {
    await sql `ALTER TABLE user_character RENAME TO user_fanto_settings`.execute(db);
    await sql `ALTER TABLE user_fanto_settings
    ADD COLUMN nickname TEXT NOT NULL DEFAULT 'Fanto',
    ADD COLUMN description TEXT NOT NULL DEFAULT '',
    ADD COLUMN avatar_media_id TEXT REFERENCES media_assets(media_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
    ADD COLUMN role_config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(role_config)='object'),
    ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.execute(db);
    await sql `UPDATE user_fanto_settings SET role_config=jsonb_build_object(
    'character',character,'scenario',scenario,'instructions',instructions,'exampleDialogues',example_dialogues)`.execute(db);
    const invalid = await sql<{
        count: string;
    }> `SELECT count(*) FROM user_fanto_settings WHERE
    (role_config->>'character') IS DISTINCT FROM character OR (role_config->>'scenario') IS DISTINCT FROM scenario OR
    (role_config->>'instructions') IS DISTINCT FROM instructions OR (role_config->>'exampleDialogues') IS DISTINCT FROM example_dialogues`.execute(db);
    if (Number(invalid.rows[0]?.count))
        throw new Error("Fanto role migration verification failed");
    await sql `ALTER TABLE user_fanto_settings DROP COLUMN character, DROP COLUMN scenario, DROP COLUMN instructions, DROP COLUMN example_dialogues`.execute(db);
    await sql `CREATE INDEX user_fanto_avatar_reference ON user_fanto_settings(avatar_media_id) WHERE avatar_media_id IS NOT NULL`.execute(db);
}
// Intentionally forward-only: reverting would discard new settings and extension keys.
export async function down() { throw new Error("Fanto settings migration requires a reviewed forward repair"); }
