import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "../../infrastructure/database/database.js";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("consolidated Fanto settings schema preserves UTF-8 role content and existing data", async () => {
  const admin = createDatabase(process.env.TEST_DATABASE_URL!);
  const name = `fanto_test_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${name}`;
  const db = createDatabase(url.href);
  try {
    await runMigrations(db);
    const date = new Date("2026-01-01T00:00:00Z");
    const role = { character: "角色😀\n\n保留换行和空格  ", scenario: "", instructions: "规则", exampleDialogues: "示例" };
    await db.insertInto("users").values({ user_id: "owner", status: "active", created_at: date, updated_at: date, disabled_at: null }).execute();
    await sql`INSERT INTO user_fanto_settings (user_id, role_config, updated_at)
      VALUES ('owner', ${JSON.stringify(role)}::jsonb, ${date})`.execute(db);
    await runMigrations(db);
    const row = await db.selectFrom("user_fanto_settings").selectAll().executeTakeFirstOrThrow();
    assert.deepEqual(row.role_config, role);
    assert.equal(row.updated_at.toISOString(), date.toISOString());
    assert.equal(row.nickname, "Fanto");
    assert.equal(row.main_session_id, null);
    const columns = await sql<{column_name: string}>`SELECT column_name FROM information_schema.columns WHERE table_name='user_fanto_settings'`.execute(db);
    for (const removed of ["character", "scenario", "instructions", "example_dialogues"])
      assert.equal(columns.rows.some(row => row.column_name === removed), false);
  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
