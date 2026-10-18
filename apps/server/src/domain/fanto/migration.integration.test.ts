import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { createDatabase } from "../../infrastructure/database/database.js";
import { up as oldUp } from "../../migrations/user_character_20261017.js";
import { up as migrate } from "../../migrations/zzz_user_fanto_settings_20261018.js";
test("old role columns migrate byte-for-byte into JSON and disappear without changing updated_at", { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const admin = createDatabase(process.env.TEST_DATABASE_URL!), name = `fanto_test_${randomUUID().replaceAll("-", "")}`;
    await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = `/${name}`;
    const db = createDatabase(url.href);
    try {
        await sql `CREATE TABLE users(user_id TEXT PRIMARY KEY); CREATE TABLE media_assets(media_id TEXT PRIMARY KEY)`.execute(db);
        await oldUp(db);
        const text = "角色😀\n\n保留换行和空格  ", date = new Date("2026-01-01T00:00:00Z");
        await sql `INSERT INTO users VALUES ('owner');`.execute(db);
        await sql `INSERT INTO user_character VALUES ('owner',${text},'','规则','示例',${date})`.execute(db);
        await db.transaction().execute(trx => migrate(trx as unknown as import("kysely").Kysely<any>));
        const result = await db.selectFrom("user_fanto_settings").selectAll().executeTakeFirstOrThrow();
        assert.equal(result.role_config.character, text);
        assert.equal(result.role_config.scenario, "");
        assert.equal(result.updated_at.toISOString(), date.toISOString());
        assert.equal(result.nickname, "Fanto");
        const columns = await sql<{
            column_name: string;
        }> `SELECT column_name FROM information_schema.columns WHERE table_name='user_fanto_settings'`.execute(db);
        for (const removed of ["character", "scenario", "instructions", "example_dialogues"])
            assert.equal(columns.rows.some(row => row.column_name === removed), false);
    }
    finally {
        await db.destroy();
        await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
        await admin.destroy();
    }
});
