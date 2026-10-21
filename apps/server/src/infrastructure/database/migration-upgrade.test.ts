import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import { Migrator, sql } from "kysely";
import { createDatabase, runMigrations } from "./database.js";
import { up as legacyBaseline } from "../../migrations/001_create_current_schema.js";
import { up as previouslyPublishedUpgrade } from "../../migrations/002_fanto_scoped_memory.js";
import { FantoService } from "../../domain/fanto/fanto-service.js";
import { MemoryService } from "../../domain/memory/memory-service.js";

async function bootRealServer(databaseUrl:string) {
  // Manual opt-in to verify the actual bootstrap/main.ts after a legacy DB upgrade.
  // No AI calls: a successful /health proves migration + service startup.
  const port=await new Promise<number>((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      server.close(()=>resolve(typeof address==="object"&&address?address.port:0));
    });
  });
  assert.ok(port>0);
  const proc=spawn("pnpm",["start"],{
    cwd:process.cwd(),detached:true,stdio:"ignore",
    env:{...process.env,DATABASE_URL:databaseUrl,HOST:"127.0.0.1",PORT:String(port)},
  });
  try {
    let healthy=false;
    for(let attempt=0;attempt<65;attempt++){
      if(proc.exitCode!==null)throw new Error("Server exited before /health");
      try {
        const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(850)});
        if(response.ok){healthy=true;break;}
      }catch{/* Startup may not have bound HTTP yet. */}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    assert.ok(healthy,"Migrated database failed real Server /health bootstrap");
  }finally {
    if(proc.pid){try{process.kill(-proc.pid,"SIGTERM");}catch{/* Already exited. */}}
  }
}

/** Emulate an already-deployed database with the *old* Kysely migration record. */
test("upgrade discards legacy memories, preserves historical sessions and starts new Fanto", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (!/test/i.test(url.pathname)) throw Error("Dedicated test database required");
  const admin = createDatabase(url.href);
  const dbName = "fanto_upgrade_test_" + randomUUID().replaceAll("-", "");
  await sql.raw("CREATE DATABASE " + dbName).execute(admin);
  url.pathname = "/" + dbName;
  const db = createDatabase(url.href);
  try {
    const old = new Migrator({db, provider: {getMigrations: async () => ({
      create_current_schema_20261019: {up: legacyBaseline, down: async () => {}},
    })}});
    const applied = await old.migrateToLatest();
    if (applied.error) throw applied.error;
    const userId = "legacy-user", oldSession = randomUUID(), fantoId = randomUUID();
    const stamp = new Date();
    await db.insertInto("users").values({user_id:userId,status:"active",created_at:stamp,updated_at:stamp,disabled_at:null}).execute();
    const sharedConfig = JSON.stringify({userMemoryEnabled:false,narrationEnabled:false,recordReadEnabled:true});
    const roleJson = JSON.stringify({character:"legacy character"});
    const ms = Date.now();
    // Two previously valid blank-nickname roles must be retained untouched.
    for (const role of [fantoId,randomUUID()]) {
      await sql`INSERT INTO user_fantos(fanto_id,user_id,nickname,description,role_config,agent_config,status,created_at,updated_at)
        VALUES(${role}::uuid,${userId},'', '',${roleJson}::jsonb,${sharedConfig}::jsonb,'active',${stamp},${stamp})`.execute(db);
      await sql`INSERT INTO agent_session.sessions(id,created_at,next_seq,user_id,agent_id,scope_key,updated_at)
        VALUES(${randomUUID()},${ms},0,${userId},'main',${role},${ms})`.execute(db);
    }
    // Previously allowed non-empty duplicate nicknames must not block startup.
    const dirtyUser = "legacy-duplicate-user";
    await db.insertInto("users").values({user_id:dirtyUser,status:"active",created_at:stamp,updated_at:stamp,disabled_at:null}).execute();
    for (const nickname of ["Alice","alice"]) {
      const id=randomUUID();
      await sql`INSERT INTO user_fantos(fanto_id,user_id,nickname,description,role_config,agent_config,status,created_at,updated_at)
        VALUES(${id}::uuid,${dirtyUser},${nickname},'',${roleJson}::jsonb,${sharedConfig}::jsonb,'active',${stamp},${stamp})`.execute(db);
      await sql`INSERT INTO agent_session.sessions(id,created_at,next_seq,user_id,agent_id,scope_key,updated_at)
        VALUES(${randomUUID()},${ms},0,${dirtyUser},'main',${id},${ms})`.execute(db);
    }
    const embedding = JSON.stringify(Array<number>(768).fill(0));
    const oldMemoryId = randomUUID(), oldUserMemoryId = randomUUID();
    await sql`INSERT INTO memories(memory_id,owner_type,owner_id,kind,content,embedding,created_at,updated_at)
      VALUES(${oldMemoryId}::uuid,'fanto',${fantoId},'shared_history','我与某人约好明天见面',${embedding}::vector,${stamp},${stamp}),
       (${oldUserMemoryId}::uuid,'user',${userId},'personal_background','用户以前住杭州',${embedding}::vector,${stamp},${stamp})`.execute(db);
    await sql`INSERT INTO agent_session.sessions(id,created_at,next_seq,user_id,agent_id,scope_key,updated_at)
      VALUES(${oldSession},${ms},1,${userId},'main','default',${ms})`.execute(db);
    await sql`INSERT INTO agent_session.entries(session_id,id,seq,type,timestamp,payload)
      VALUES(${oldSession},'historical-entry',0,'custom',${ms},'{}'::jsonb)`.execute(db);

    await runMigrations(db);
    await runMigrations(db); // A server restart must not replay the upgrade.
    const records = (await sql<{name:string}>`SELECT name FROM kysely_migration ORDER BY name`.execute(db)).rows;
    assert.deepEqual(records.map(row=>row.name),["001_create_current_schema","002_fanto_scoped_memory","003_drop_legacy_memories"]);
    assert.equal((await sql`SELECT 1 FROM agent_session.sessions WHERE id=${oldSession} AND scope_key='default'`.execute(db)).rows.length,1);
    assert.equal((await sql`SELECT 1 FROM agent_session.entries WHERE session_id=${oldSession} AND id='historical-entry'`.execute(db)).rows.length,1);
    const legacy=(await sql<{relation:string|null}>`
      SELECT to_regclass('public.memories_legacy_002')::text AS relation
    `.execute(db)).rows[0];
    assert.equal(legacy?.relation,null,"upgrade must remove old user and character memories");
    assert.equal((await sql`SELECT 1 FROM memories`.execute(db)).rows.length,0);
    await assert.rejects(sql`INSERT INTO agent_session.sessions(id,created_at,next_seq,user_id,agent_id,scope_key,updated_at)
      VALUES(${randomUUID()},${ms},0,${userId},'main','default',${ms})`.execute(db));
    await assert.rejects(sql`INSERT INTO user_fantos(fanto_id,user_id,nickname) VALUES(${randomUUID()}::uuid,${userId},' ')`.execute(db));

    // Existing duplicates survive, while future duplicate inserts are blocked
    // even on a database where the partial unique index cannot be built.
    assert.equal((await sql<{count:number}>`SELECT count(*)::int AS count FROM user_fantos WHERE user_id=${dirtyUser}`.execute(db)).rows[0]?.count,2);
    await assert.rejects(sql`INSERT INTO user_fantos(fanto_id,user_id,nickname)
      VALUES(${randomUUID()}::uuid,${dirtyUser},'ALICE')`.execute(db));
    const service = FantoService.create(db,{validateAvatar:async()=>true} as never);
    const defaultSession = await service.defaultSession(userId);
    assert.notEqual(defaultSession.scopeKey,"default");
    assert.notEqual(defaultSession.sessionId,oldSession);
    assert.equal((await service.defaultSession(userId)).sessionId,defaultSession.sessionId);
    assert.equal((await service.list(userId)).length,3);
    await assert.rejects(service.create(userId,{nickname:"FANTO"}),{code:"FANTO_NAME_TAKEN"});
    const memories = MemoryService.create(db,{embed:async()=>Array(768).fill(0)});
    await memories.create(defaultSession.scopeKey,{content:"我知道霄汉的名字。"});
    assert.equal((await memories.list(defaultSession.scopeKey)).length,1);
    assert.equal((await memories.list(fantoId)).length,0);
    assert.equal((await sql<{count:number}>`SELECT count(*)::int AS count FROM memories`.execute(db)).rows[0]?.count,1,
      "newly written Fanto memory remains available after deleting legacy data");
    if(process.env.MIGRATION_BOOT_SMOKE==="1") await bootRealServer(url.href);
  } finally {
    await db.destroy();
    await sql.raw("DROP DATABASE " + dbName + " WITH (FORCE)").execute(admin);
    await admin.destroy();
  }
});

/** A database already at 002 must be cleaned without touching new Fanto memory. */
test("003 removes an existing memory archive but keeps current Fanto memories", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (!/test/i.test(url.pathname)) throw Error("Dedicated test database required");
  const admin = createDatabase(url.href);
  const dbName = "fanto_cleanup_test_" + randomUUID().replaceAll("-", "");
  await sql.raw("CREATE DATABASE " + dbName).execute(admin);
  url.pathname = "/" + dbName;
  const db = createDatabase(url.href);
  try {
    const old = new Migrator({ db, provider: {getMigrations:async()=>({
      "001_create_current_schema":{up:legacyBaseline,down:async()=>{}},
      "002_fanto_scoped_memory":{up:previouslyPublishedUpgrade,down:async()=>{}},
    })} });
    const applied=await old.migrateToLatest();
    if (applied.error) throw applied.error;
    const fantoId=randomUUID(), memoryId=randomUUID(), now=new Date();
    const vector=JSON.stringify(Array(768).fill(0));
    await sql`INSERT INTO public.memories_legacy_002(memory_id,owner_type,owner_id,kind,content,embedding,created_at,updated_at)
      VALUES(${randomUUID()}::uuid,'user','some-user','personal_background','must be removed',${vector}::vector,${now},${now})`.execute(db);
    await sql`INSERT INTO public.memories(memory_id,fanto_id,content,embedding,created_at,updated_at)
      VALUES(${memoryId}::uuid,${fantoId}::uuid,'must be preserved',${vector}::vector,${now},${now})`.execute(db);
    await runMigrations(db);
    await runMigrations(db);
    assert.equal((await sql<{present:boolean}>`SELECT to_regclass('public.memories_legacy_002') IS NOT NULL AS present`.execute(db)).rows[0]?.present,false);
    assert.equal((await sql<{content:string}>`SELECT content FROM public.memories WHERE memory_id=${memoryId}::uuid`.execute(db)).rows[0]?.content,"must be preserved");
    assert.deepEqual((await sql<{name:string}>`SELECT name FROM kysely_migration ORDER BY name`.execute(db)).rows.map(row=>row.name),
      ["001_create_current_schema","002_fanto_scoped_memory","003_drop_legacy_memories"]);
  } finally {
    await db.destroy();
    await sql.raw("DROP DATABASE " + dbName + " WITH (FORCE)").execute(admin);
    await admin.destroy();
  }
});
