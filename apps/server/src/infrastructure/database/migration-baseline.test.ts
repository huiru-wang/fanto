import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "./database.js";

const oldMigrations = [
  "extend_auth_schema",
  "update_auth_challenge_purpose",
  "z_task_system_schema",
  "zz_project_domain_refactor",
  "zzz_record_location",
  "zzzz_drop_user_preferences",
  "zzzzz_memory_schema",
  "zzzzzz_creative_runtime",
  "zzzzzzz_project_domain_upgrade",
  "zzzzzzzz_project_summary_embedding",
  "zzzzzzzzz_proposal_creation_goal",
  "zzzzzzzzzz_media_object_deletions",
  "zzzzzzzzzzz_project_session_goal",
];

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration("baseline initializes fresh databases and consolidates only complete migration history", async () => {
  const admin = createDatabase(process.env.TEST_DATABASE_URL!);
  const name = `baseline_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${name}`;
  const db = createDatabase(url.href);

  try {
    await runMigrations(db);
    await runMigrations(db);
    const names = async () => (await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name`.execute(db)).rows.map(row => row.name);
    assert.deepEqual(await names(), ["create_current_schema"]);

    const tables = (await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()
    `.execute(db)).rows.map(row => row.table_name);
    for (const required of ["users", "records", "media_assets", "media_object_deletions", "tasks",
      "task_runs", "memories", "projects", "proposals", "record_links"]) {
      assert.ok(tables.includes(required), `Missing ${required}`);
    }
    for (const obsolete of ["proposal_runs", "creation_runs", "creation_image_steps", "legacy_projects"]) {
      assert.ok(!tables.includes(obsolete), `Unexpected ${obsolete}`);
    }

    const columns = (await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema()
        AND table_name = 'projects'
    `.execute(db)).rows.map(row => row.column_name);
    for (const column of ["goal", "summary", "embedding", "session_id"]) assert.ok(columns.includes(column));

    const userId = randomUUID();
    const now = new Date();
    await db.insertInto("users").values({ user_id: userId, status: "active", created_at: now, updated_at: now, disabled_at: null }).execute();
    // Reproduce the old Kysely metadata without recreating or dropping user data.
    for (const [index, migration] of oldMigrations.entries()) {
      await sql`INSERT INTO kysely_migration (name, timestamp) VALUES (${migration}, ${new Date(Date.now() + index * 1000).toISOString()})`.execute(db);
    }
    await runMigrations(db);
    assert.deepEqual(await names(), ["create_current_schema"]);
    assert.equal((await db.selectFrom("users").select("user_id").executeTakeFirstOrThrow()).user_id, userId);
    await runMigrations(db); // Idempotent after consolidation.

    await sql`INSERT INTO kysely_migration (name, timestamp) VALUES ('extend_auth_schema', ${new Date().toISOString()})`.execute(db);
    await assert.rejects(runMigrations(db), /Cannot consolidate incomplete\/unknown migration history/);
    assert.deepEqual(await names(), ["create_current_schema", "extend_auth_schema"]);
  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
