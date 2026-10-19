import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "./database.js";

const migrations = ["create_current_schema_20261019"];
const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration("reset baseline creates the final schema and replays without recreating objects or losing data", async () => {
  if (!/test/i.test(new URL(process.env.TEST_DATABASE_URL!).pathname)) throw new Error("Dedicated test database required");
  const admin = createDatabase(process.env.TEST_DATABASE_URL!);
  const name = `baseline_test_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = createDatabase(url.href);
  const names = async () => (await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name`.execute(db)).rows.map(r => r.name);
  const dropHistory = async () => { await sql`DROP TABLE kysely_migration, kysely_migration_lock`.execute(db); };
  const schema = async () => ({
    // Stable OIDs prove existing tables were not dropped and rebuilt.
    tables: (await sql`SELECT n.nspname, c.relname, c.oid FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','agent_session') AND c.relkind='r'
      AND c.relname NOT LIKE 'kysely_%' ORDER BY n.nspname,c.relname`.execute(db)).rows,
    indexes: (await sql`SELECT schemaname,indexname,indexdef FROM pg_indexes
      WHERE schemaname IN ('public','agent_session') AND tablename NOT LIKE 'kysely_%'
      ORDER BY schemaname,indexname`.execute(db)).rows,
    constraints: (await sql`SELECT n.nspname,c.relname,p.conname,pg_get_constraintdef(p.oid) AS definition
      FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','agent_session') AND c.relname NOT LIKE 'kysely_%'
      ORDER BY n.nspname,c.relname,p.conname`.execute(db)).rows,
  });
  try {
    await runMigrations(db);
    assert.deepEqual(await names(), migrations);
    const publicTables = (await sql<{ table_name: string }>`SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`.execute(db)).rows.map(r => r.table_name);
    assert.deepEqual(publicTables, ["auth_challenges", "kysely_migration", "kysely_migration_lock", "media_assets", "memories",
      "projects", "proposals", "record_links", "records", "user_fanto_settings", "user_login_identities", "user_profiles", "users"]);
    const agentTables = (await sql<{ table_name: string }>`SELECT table_name FROM information_schema.tables
      WHERE table_schema='agent_session' ORDER BY table_name`.execute(db)).rows.map(r => r.table_name);
    assert.deepEqual(agentTables, ["entries", "sessions", "usage_ledger"]);
    const columns = (await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='user_fanto_settings'`.execute(db)).rows.map(r => r.column_name);
    assert.ok(columns.includes("fanto_id") && columns.includes("session_id"));
    assert.ok(!columns.includes("main_session_id"));
    const primaryKey = (await sql<{ definition: string }>`SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid='user_fanto_settings'::regclass AND contype='p'`.execute(db)).rows;
    assert.deepEqual(primaryKey, [{ definition: "PRIMARY KEY (fanto_id)" }]);

    const userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insertInto("users").values({ user_id: userId, status: "active", created_at: now, updated_at: now, disabled_at: null }).execute();
    await sql`INSERT INTO user_fanto_settings (user_id,nickname,session_id,role_config)
      VALUES (${userId},'保留角色😀',${sessionId},'{"character":"不能丢失"}'::jsonb)`.execute(db);
    await sql`INSERT INTO user_profiles (user_id,signature) VALUES (${userId},'保留签名')`.execute(db);
    await sql`INSERT INTO agent_session.sessions (id,created_at,next_seq,user_id,agent_id,updated_at)
      VALUES (${sessionId},0,0,${userId},'main',0)`.execute(db);
    const settings = await db.selectFrom("user_fanto_settings").selectAll().execute();
    const before = await schema();
    await Promise.all([runMigrations(db), runMigrations(db)]);
    assert.deepEqual(await schema(), before);

    // Missing metadata: baseline must execute again while keeping tables, indexes and rows intact.
    await dropHistory();
    await runMigrations(db);
    assert.deepEqual(await names(), migrations);
    assert.deepEqual(await schema(), before);
    assert.deepEqual(await db.selectFrom("user_fanto_settings").selectAll().execute(), settings);
    assert.equal((await db.selectFrom("user_profiles").select("signature").executeTakeFirstOrThrow()).signature, "保留签名");
    assert.equal((await sql`SELECT 1 FROM agent_session.sessions WHERE id=${sessionId}`.execute(db)).rows.length, 1);

    // A partially existing current schema is also supported when history is reset.
    await sql`DROP TABLE projects; DROP INDEX idx_records_user_event`.execute(db);
    await dropHistory();
    await runMigrations(db);
    assert.ok((await sql`SELECT 1 FROM projects`.execute(db)).rows.length === 0);
    assert.deepEqual((await schema()).indexes, before.indexes);
    assert.deepEqual(await db.selectFrom("user_fanto_settings").selectAll().execute(), settings);

    // User's full reset: remove both business schemas (including metadata), then rebuild twice.
    await sql`DROP SCHEMA agent_session CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public`.execute(db);
    await runMigrations(db);
    await runMigrations(db);
    assert.deepEqual(await names(), migrations);
    assert.deepEqual((await schema()).indexes, before.indexes);
    assert.deepEqual((await schema()).constraints, before.constraints);
    assert.equal((await db.selectFrom("users").selectAll().execute()).length, 0);
  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
