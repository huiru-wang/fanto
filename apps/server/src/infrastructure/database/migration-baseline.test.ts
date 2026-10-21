import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {sql} from "kysely";
import {createDatabase,runMigrations} from "./database.js";
test("numbered migrations create current schema without foreign keys and are idempotent",{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const admin=createDatabase(process.env.TEST_DATABASE_URL!),name="baseline_test_"+randomUUID().replaceAll("-","");
 await sql.raw("CREATE DATABASE "+name).execute(admin);
 const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname="/"+name;
 const db=createDatabase(url.href);
 try{
  await runMigrations(db);await runMigrations(db);
  const names=(await sql<{table_name:string}>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`.execute(db)).rows.map(r=>r.table_name);
  assert.ok(names.includes("user_fantos")&&!names.includes("user_fanto_settings"));
  assert.ok(!names.includes("projects")&&!names.includes("proposals"));
  const keys=(await sql`SELECT conname FROM pg_constraint WHERE contype='f' AND connamespace IN ('public'::regnamespace,'agent_session'::regnamespace)`.execute(db)).rows;
  assert.equal(keys.length,0);
  const migrations=(await sql<{name:string}>`SELECT name FROM kysely_migration ORDER BY name`.execute(db)).rows;
  assert.deepEqual(migrations.map(row=>row.name),["001_create_current_schema","002_fanto_scoped_memory","003_drop_legacy_memories"]);
  const cols=(await sql<{column_name:string}>`SELECT column_name FROM information_schema.columns WHERE table_name='memories'`.execute(db)).rows.map(row=>row.column_name);
  assert.ok(cols.includes("fanto_id") && !cols.includes("kind") && !cols.includes("owner_type"));
  const legacy=(await sql<{relation:string|null}>`SELECT to_regclass('public.memories_legacy_002')::text AS relation`.execute(db)).rows[0];
  assert.equal(legacy?.relation,null,"fresh installs must not retain legacy memory archives");

 }finally{await db.destroy();await sql.raw("DROP DATABASE "+name+" WITH (FORCE)").execute(admin);await admin.destroy();}
});
