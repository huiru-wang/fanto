import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {sql} from "kysely";
import {createDatabase,runMigrations} from "./database.js";
import {up as replay} from "../../migrations/create_current_schema_20261019.js";
test("baseline creates owner schema without foreign keys and remains replayable",{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const admin=createDatabase(process.env.TEST_DATABASE_URL!),name="baseline_test_"+randomUUID().replaceAll("-","");
 await sql.raw("CREATE DATABASE "+name).execute(admin);
 const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname="/"+name;
 const db=createDatabase(url.href);
 try{
  await runMigrations(db);await runMigrations(db);
  await replay(db);
  const names=(await sql<{table_name:string}>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`.execute(db)).rows.map(r=>r.table_name);
  assert.ok(names.includes("user_fantos")&&!names.includes("user_fanto_settings"));
  assert.ok(!names.includes("projects")&&!names.includes("proposals"));
  const keys=(await sql`SELECT conname FROM pg_constraint WHERE contype='f' AND connamespace IN ('public'::regnamespace,'agent_session'::regnamespace)`.execute(db)).rows;
  assert.equal(keys.length,0);
  const migrations=(await sql<{name:string}>`SELECT name FROM kysely_migration ORDER BY name`.execute(db)).rows;
  assert.deepEqual(migrations.map(row=>row.name),["create_current_schema_20261019"]);

 }finally{await db.destroy();await sql.raw("DROP DATABASE "+name+" WITH (FORCE)").execute(admin);await admin.destroy();}
});
