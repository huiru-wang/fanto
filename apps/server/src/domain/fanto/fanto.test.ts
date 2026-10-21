import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {createDatabase,runMigrations} from "../../infrastructure/database/database.js";
import {sql} from "kysely";
import {FantoService} from "./fanto-service.js";
import {fantoCreateSchema,fantoPatchSchema} from "./model.js";

test("nickname is required, role fields can be empty, and identity is not patchable",()=>{
 assert.equal(fantoCreateSchema.safeParse({}).success,false);
 assert.equal(fantoCreateSchema.safeParse({nickname:""}).success,false);
 assert.equal(fantoCreateSchema.safeParse({nickname:"  "}).success,false);
 assert.equal(fantoCreateSchema.parse({nickname:"  A "}).nickname,"A");
 assert.equal(fantoCreateSchema.safeParse({nickname:"A",roleConfig:{character:"",scenario:""}}).success,true);
 assert.equal(fantoPatchSchema.safeParse({fantoId:randomUUID(),expectedVersion:1,changes:{agentConfig:{fantoMemoryEnabled:true}}}).success,true);
 for(const field of ["nickname","roleConfig","sessionId","status","deleted"]){
   assert.equal(fantoPatchSchema.safeParse({fantoId:randomUUID(),expectedVersion:1,changes:{[field]:"wrong"}}).success,false);
 }
});

test("multi-character lifecycle creates at most three active, archives, restores and physically deletes", {skip:!process.env.TEST_DATABASE_URL},async()=>{
 if(!/test/i.test(new URL(process.env.TEST_DATABASE_URL!).pathname))throw new Error("Dedicated test database required");
 const db=createDatabase(process.env.TEST_DATABASE_URL!);
 const owner=randomUUID(),other=randomUUID(),now=new Date();
 try{
  await runMigrations(db);
  await db.insertInto("users").values([owner,other].map(user_id=>({user_id,status:"active" as const,created_at:now,updated_at:now,disabled_at:null}))).execute();
  const service=FantoService.create(db,{validateAvatar:async()=>true,queueFantoDeletion:async()=>{},finishFantoDeletion:async()=>true} as never);
  const main=await service.defaultSession(owner);
  assert.equal((await service.defaultSession(owner)).sessionId,main.sessionId);
  const attempts=await Promise.allSettled(["A","B","C"].map(nickname=>service.create(owner,{nickname})));
  const roles=attempts.flatMap(result=>result.status==="fulfilled"?[result.value]:[]);
  assert.equal(roles.length,2);
  assert.equal(attempts.filter(result=>result.status==="rejected").length,1);
  assert.equal(new Set(roles.map(r=>r.sessionId)).size,2);
  await assert.rejects(service.create(owner,{nickname:"D"}),{code:"FANTO_LIMIT_REACHED"});
  assert.equal((await service.getForSession(owner,roles[0]!.sessionId))?.fantoId,roles[0]!.fantoId);
  await assert.rejects(service.get(other,roles[0]!.fantoId),{code:"NOT_FOUND"});
  const archived=await service.setArchive(owner,{fantoId:roles[0]!.fantoId,expectedVersion:roles[0]!.version},true);
  await assert.rejects(service.getForSession(owner,archived.sessionId),{code:"INVALID_STATE"});
  assert.equal((await service.list(owner)).length,2);
  await service.create(owner,{nickname:"New"});
  await assert.rejects(service.setArchive(owner,{fantoId:archived.fantoId,expectedVersion:archived.version},false),{code:"FANTO_LIMIT_REACHED"});
  await service.remove(owner,{fantoId:archived.fantoId,expectedVersion:archived.version});
  assert.equal((await service.list(owner,true)).length,3);
  assert.equal((await sql<{n:number}>`SELECT COUNT(*)::int AS n FROM agent_session.sessions WHERE scope_key=${archived.fantoId}`.execute(db)).rows[0]!.n,0);
  assert.equal((await service.defaultSession(owner)).sessionId,main.sessionId);
 }finally{
  await sql`DELETE FROM agent_session.usage_ledger WHERE session_id IN (SELECT id FROM agent_session.sessions WHERE user_id IN (${owner},${other}))`.execute(db);
  await sql`DELETE FROM agent_session.entries WHERE session_id IN (SELECT id FROM agent_session.sessions WHERE user_id IN (${owner},${other}))`.execute(db);
  await sql`DELETE FROM agent_session.sessions WHERE user_id IN (${owner},${other})`.execute(db);
  await db.deleteFrom("user_fantos").where("user_id","in",[owner,other]).execute();
  await db.deleteFrom("users").where("user_id","in",[owner,other]).execute();
  await db.destroy();
 }
});
