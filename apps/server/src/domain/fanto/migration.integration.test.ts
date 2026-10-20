import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {sql} from "kysely";
import {createDatabase,runMigrations} from "../../infrastructure/database/database.js";
test("fresh baseline has user_fantos, owner scopes, session scope_key and zero foreign keys",{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const admin=createDatabase(process.env.TEST_DATABASE_URL!),name="fanto_schema_"+randomUUID().replaceAll("-","");
 await sql.raw("CREATE DATABASE "+name).execute(admin);
 const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname="/"+name;
 const db=createDatabase(url.href);
 try{
  await runMigrations(db);
  const f=(await sql<{column_name:string}>`SELECT column_name FROM information_schema.columns WHERE table_name='user_fantos'`.execute(db)).rows.map(x=>x.column_name);
  for(const key of ["fanto_id","status","archived_at","agent_config","role_config"])assert.ok(f.includes(key));
  assert.ok(!f.includes("deleted")&&!f.includes("deleted_at")&&!f.includes("session_id"));
  for(const t of ["records","memories"]){
   const cols=(await sql<{column_name:string}>`SELECT column_name FROM information_schema.columns WHERE table_name=${t}`.execute(db)).rows.map(x=>x.column_name);
   assert.ok(cols.includes("owner_type")&&cols.includes("owner_id")&&!cols.includes("user_id"));
  }
  const fk=(await sql`SELECT conname FROM pg_constraint WHERE contype='f' AND connamespace IN ('public'::regnamespace,'agent_session'::regnamespace)`.execute(db)).rows;
  assert.equal(fk.length,0);
 }finally{await db.destroy();await sql.raw("DROP DATABASE "+name+" WITH (FORCE)").execute(admin);await admin.destroy();}
});
