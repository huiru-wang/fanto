import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {createDatabase,runMigrations} from "../../infrastructure/database/database.js";
import {sql} from "kysely";
import {FantoService} from "../../domain/fanto/fanto-service.js";
import {CheckpointRepository} from "./postgres-repository.js";
test("checkpoint sessions preserve default and role scope identity",{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const admin=createDatabase(process.env.TEST_DATABASE_URL!),name="scope_checkpoint_"+randomUUID().replaceAll("-","");
 await sql.raw("CREATE DATABASE "+name).execute(admin);
 const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname="/"+name;
 const db=createDatabase(url.href);
 try{
  await runMigrations(db);
  const user=randomUUID(),now=new Date();
  await db.insertInto("users").values({user_id:user,status:"active",created_at:now,updated_at:now,disabled_at:null}).execute();
  const service=FantoService.create(db,{validateAvatar:async()=>true} as never);
  const baseline=await service.defaultSession(user);
  const role=await service.create(user,{});
  const repo=new CheckpointRepository(db);
  assert.equal((await repo.getSession(baseline.sessionId,user))?.scopeKey,"default");
  assert.equal((await repo.getSession(role.sessionId,user))?.scopeKey,role.fantoId);
  assert.notEqual(baseline.sessionId,role.sessionId);
  assert.equal((await repo.getSession(role.sessionId,"unknown")),undefined);
 }finally{await db.destroy();await sql.raw("DROP DATABASE "+name+" WITH (FORCE)").execute(admin);await admin.destroy();}
});
