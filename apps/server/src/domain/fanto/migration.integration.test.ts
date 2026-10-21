import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {sql} from "kysely";
import {createDatabase,runMigrations} from "../../infrastructure/database/database.js";
test("fresh baseline has unique Fanto names, role-only memory, UUID session scopes and zero foreign keys",{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const admin=createDatabase(process.env.TEST_DATABASE_URL!),name="fanto_schema_"+randomUUID().replaceAll("-","");
 await sql.raw("CREATE DATABASE "+name).execute(admin);
 const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname="/"+name;
 const db=createDatabase(url.href);
 try{
  await runMigrations(db);
  const f=(await sql<{column_name:string}>`SELECT column_name FROM information_schema.columns WHERE table_name='user_fantos'`.execute(db)).rows.map(x=>x.column_name);
  for(const key of ["fanto_id","status","archived_at","agent_config","role_config"])assert.ok(f.includes(key));
  assert.ok(!f.includes("deleted")&&!f.includes("deleted_at")&&!f.includes("session_id"));
  const records=(await sql<{column_name:string}>`SELECT column_name FROM information_schema.columns WHERE table_name='records'`.execute(db)).rows.map(x=>x.column_name);
  assert.ok(records.includes("owner_type")&&records.includes("owner_id"));
  const memories=(await sql<{column_name:string}>`SELECT column_name FROM information_schema.columns WHERE table_name='memories'`.execute(db)).rows.map(x=>x.column_name);
  assert.ok(memories.includes("fanto_id")&&!memories.includes("owner_type")&&!memories.includes("owner_id")&&!memories.includes("kind"));
  const unique=(await sql<{indexname:string}>`SELECT indexname FROM pg_indexes WHERE tablename='user_fantos'`.execute(db)).rows;
  assert.ok(unique.some(item=>item.indexname==='user_fanto_unique_nickname'));
  const fk=(await sql`SELECT conname FROM pg_constraint WHERE contype='f' AND connamespace IN ('public'::regnamespace,'agent_session'::regnamespace)`.execute(db)).rows;
  assert.equal(fk.length,0);
 }finally{await db.destroy();await sql.raw("DROP DATABASE "+name+" WITH (FORCE)").execute(admin);await admin.destroy();}
});
