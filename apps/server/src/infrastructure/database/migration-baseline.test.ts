import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "./database.js";

const baseline = "create_current_schema_20261019";
const modern = [
  "create_current_schema_20261011", "drop_tasks_20261011", "user_character_20261017",
  "z_agent_session_snapshots_20261017", "zz_memory_kinds_20261017",
  "zzz_user_fanto_settings_20261018", "zzzz_user_profiles_20261018",
  "zzzzz_user_profile_cover_20261018", "zzzzzz_agent_checkpoint_20261019",
];
const previous = ["create_current_schema", "zzzzzz_async_v3", "zzzzzzzzzzzz_agent_sessions_pg", "zzzzzzzzzzzzz_drop_users_wx_openid"];
const legacy = [
  "extend_auth_schema", "update_auth_challenge_purpose", "z_task_system_schema", "zz_project_domain_refactor",
  "zzz_record_location", "zzzz_drop_user_preferences", "zzzzz_memory_schema", "zzzzzz_creative_runtime",
  "zzzzzzz_project_domain_upgrade", "zzzzzzzz_project_summary_embedding", "zzzzzzzzz_proposal_creation_goal",
  "zzzzzzzzzz_media_object_deletions", "zzzzzzzzzzz_project_session_goal",
];
const finalCleanup = "zzzzzzz_agent_storage_cleanup_20261019";
const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration("current baseline and recovery from fully deleted Agent storage", async () => {
  if (!/test/i.test(new URL(process.env.TEST_DATABASE_URL!).pathname)) throw new Error("Dedicated test database required");
  const admin = createDatabase(process.env.TEST_DATABASE_URL!);
  const name = `baseline_test_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = createDatabase(url.href);
  const names = async () => (await sql<{name:string}>`SELECT name FROM kysely_migration ORDER BY name`.execute(db)).rows.map(r => r.name);
  const tables = async () => (await sql<{table_name:string}>`SELECT table_name FROM information_schema.tables
    WHERE table_schema='agent_session' ORDER BY table_name`.execute(db)).rows.map(r => r.table_name);
  const setHistory = async (history: string[]) => {
    await sql`DELETE FROM kysely_migration WHERE name <> 'fanto_identity_20261019'`.execute(db);
    for (let i=0; i<history.length; i++) await sql`INSERT INTO kysely_migration(name,timestamp)
      VALUES (${history[i]},${new Date(1700000000000 + i*1000).toISOString()})`.execute(db);
  };
  try {
    await runMigrations(db); await runMigrations(db);
    assert.deepEqual(await names(), [baseline, "fanto_identity_20261019"]);
    assert.deepEqual(await tables(), ["entries", "sessions", "usage_ledger"]);
    const business = (await sql<{table_name:string}>`SELECT table_name FROM information_schema.tables
      WHERE table_schema='public'`.execute(db)).rows.map(r => r.table_name);
    for (const required of ["users", "user_fanto_settings", "user_profiles", "records", "media_assets", "memories", "projects", "proposals", "record_links"])
      assert.ok(business.includes(required), `Missing ${required}`);
    for (const old of ["tasks", "task_runs", "user_character", "proposal_runs", "creation_runs", "media_object_deletions"])
      assert.ok(!business.includes(old), `Unexpected ${old}`);
    const cols = (await sql<{table_name:string;column_name:string}>`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='agent_session'`.execute(db)).rows;
    for (const col of ["user_id", "agent_id", "next_seq", "created_at", "updated_at", "tip_entry_id"])
      assert.ok(cols.some(r => r.table_name==='sessions' && r.column_name===col), col);
    for (const col of ["run_id", "provider", "model", "created_at"])
      assert.ok(cols.some(r => r.table_name==='usage_ledger' && r.column_name===col), col);
    for (const obsolete of ["metadata", "storage_version", "parent_session_id", "usage_payload"])
      assert.ok(!cols.some(r => r.table_name==='sessions' && r.column_name===obsolete), obsolete);

    const userId=randomUUID(), now=new Date();
    await db.insertInto('users').values({user_id:userId,status:'active',created_at:now,updated_at:now,disabled_at:null}).execute();
    await sql`INSERT INTO user_fanto_settings (user_id,session_id) VALUES (${userId}, 'deleted-id')`.execute(db);
    await sql`DROP TABLE agent_session.entries,agent_session.sessions,agent_session.usage_ledger`.execute(db);
    await setHistory(modern); // Mirrors actual deployed DB, cleanup not applied.
    await runMigrations(db); await runMigrations(db);
    assert.deepEqual(await names(),[baseline, "fanto_identity_20261019"]);
    assert.deepEqual(await tables(),["entries","sessions","usage_ledger"]);
    assert.equal((await db.selectFrom('users').select('user_id').executeTakeFirstOrThrow()).user_id,userId);
    assert.equal((await db.selectFrom('user_fanto_settings').select('session_id').executeTakeFirstOrThrow()).session_id,null);

    // Complete old history and valid V2 records are preserved.
    const sessionId=randomUUID();
    await sql`INSERT INTO agent_session.sessions (id,created_at,next_seq,user_id,agent_id,updated_at)
      VALUES (${sessionId},0,0,${userId},'main',0)`.execute(db);
    await setHistory([...modern,finalCleanup]);
    await runMigrations(db);
    assert.deepEqual(await names(),[baseline, "fanto_identity_20261019"]);
    assert.equal((await sql`SELECT 1 FROM agent_session.sessions WHERE id=${sessionId}`.execute(db)).rows.length,1);
    await setHistory([...previous,...legacy,...modern,finalCleanup]);
    await runMigrations(db);
    assert.deepEqual(await names(),[baseline, "fanto_identity_20261019"]);

    // Never stamp incomplete or unrecognized histories as current.
    await setHistory(modern.slice(0,-1));
    await assert.rejects(runMigrations(db),/Cannot consolidate incomplete\/unknown migration history/);
    assert.deepEqual(await names(),[...modern.slice(0,-1), "fanto_identity_20261019"].sort());
    await setHistory([...modern,'unknown_migration']);
    await assert.rejects(runMigrations(db),/Cannot consolidate incomplete\/unknown migration history/);

    // When only some tables were dropped, avoid overwriting surviving data.
    await setHistory(modern);
    await sql`DROP TABLE agent_session.entries`.execute(db);
    await assert.rejects(runMigrations(db),/Partially missing Agent checkpoint tables/);
    assert.deepEqual(await names(),[...modern, "fanto_identity_20261019"].sort());
  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
