import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {sql} from "kysely";
import {createDatabase,runMigrations} from "../../infrastructure/database/database.js";
import {FantoService} from "./fanto-service.js";
import {MediaService} from "../media/media-service.js";
import {MemoryService} from "../memory/memory-service.js";
import {createApp} from "../../bootstrap/app.js";
import {CheckpointRepository} from "../../agent/checkpoint/postgres-repository.js";

test("role lifecycle gates runs, drains checkpoints, preserves owners and retries physical media deletion",{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const url=new URL(process.env.TEST_DATABASE_URL!);
  if(!/test/i.test(url.pathname))throw Error("Dedicated test database required");
  const admin=createDatabase(url.href),name="fanto_lifecycle_test_"+randomUUID().replaceAll("-","");
  await sql.raw("CREATE DATABASE "+name).execute(admin);url.pathname="/"+name;
  const db=createDatabase(url.href);
  try{
    await runMigrations(db);
    const user=randomUUID(),other=randomUUID(),now=new Date();
    await db.insertInto("users").values([user,other].map(user_id=>({user_id,status:"active" as const,created_at:now,updated_at:now,disabled_at:null}))).execute();
    let closeFails=false;
    let fail=true;const removed:string[]=[],running=new Set<string>(),closed:string[]=[];
    const media=MediaService.create(db,{remove:async(key:string)=>{if(fail)throw Error("storage offline");removed.push(key);}} as never);
    const service=FantoService.create(db,media);
    service.bindSessions({isRunning:id=>running.has(id),release:async id=>{
      if(closeFails)throw Error("checkpoint unavailable");
      // Simulate the final asynchronous checkpoint being drained before parent deletion.
      await sql`INSERT INTO agent_session.entries(session_id,id,seq,type,timestamp,payload)
        VALUES(${id},'last',0,'custom',0,'{}'::jsonb)`.execute(db);
      closed.push(id);
    }});
    const main=await service.defaultSession(user);
    const a=await service.create(user,{nickname:"A",roleConfig:{character:null},agentConfig:{narrationEnabled:true}});
    const b=await service.create(user,{nickname:"B"});
    let changed=await service.patch(user,{fantoId:a.fantoId,expectedVersion:1,changes:{agentConfig:{fantoMemoryEnabled:false}}});
    assert.equal(changed.agentConfig.narrationEnabled,true);
    await assert.rejects(service.patch(user,{fantoId:a.fantoId,expectedVersion:1,changes:{agentConfig:{recordReadEnabled:true}}}),{code:"VERSION_CONFLICT"});
    let entered!:()=>void,proceed!:()=>void;
    const ready=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{proceed=resolve;});
    const reservation=service.reserveRun(user,a.sessionId,async()=>{
      entered();await held;running.add(a.sessionId);return ()=>{running.delete(a.sessionId);};
    });
    await ready;
    const racingArchive=assert.rejects(service.setArchive(user,{fantoId:a.fantoId,expectedVersion:changed.version},true),{code:"FANTO_BUSY"});
    proceed();const release=await reservation;await racingArchive;
    for(const action of [()=>service.setArchive(user,{fantoId:a.fantoId,expectedVersion:changed.version},true),
      ()=>service.remove(user,{fantoId:a.fantoId,expectedVersion:changed.version}),
      ()=>service.patch(user,{fantoId:a.fantoId,expectedVersion:changed.version,changes:{agentConfig:{recordReadEnabled:true}}})]){
      await assert.rejects(action(),{code:"FANTO_BUSY"});
    }
    release();
    changed=await service.setArchive(user,{fantoId:a.fantoId,expectedVersion:changed.version},true);
    await assert.rejects(service.reserveRun(user,a.sessionId,()=>()=>{}),{code:"INVALID_STATE"});
    changed=await service.setArchive(user,{fantoId:a.fantoId,expectedVersion:changed.version},false);
    assert.equal(changed.sessionId,a.sessionId);
    await assert.rejects(service.reserveRun(other,a.sessionId,()=>()=>{}),{code:"NOT_FOUND"});
    const memories=MemoryService.create(db,{embed:async()=>Array(768).fill(0)});
    await memories.create(main.scopeKey,{content:"default Fanto fact"});
    await memories.create(a.fantoId,{content:"role A fact"});
    await memories.create(b.fantoId,{content:"role B fact"});
    const avatar=randomUUID(),record=randomUUID(),userRecord=randomUUID(),stamp=now.toISOString();
    await db.insertInto("media_assets").values({media_id:avatar,user_id:user,object_key:"role-avatar",media_type:"image",mime_type:"image/png",bytes:100,status:"ready",ext_data:JSON.stringify({purpose:"fanto_avatar"}),created_at:stamp,updated_at:stamp}).execute();
    changed=await service.patch(user,{fantoId:a.fantoId,expectedVersion:changed.version,changes:{avatarMediaId:avatar}});
    for(const [recordId,ownerType,ownerId] of [[record,"fanto",a.fantoId],[userRecord,"user",user]] as const){
      await sql`INSERT INTO records(record_id,owner_type,owner_id,source,content,version,status,event_at,created_at,updated_at)
        VALUES(${recordId},${ownerType},${ownerId},'test','{"text":"x","blocks":[]}',1,'processed',${stamp},${stamp},${stamp})`.execute(db);
    }
    const app=createApp({auth:{sessions: { verify:async()=>({userId:user}) },assertActiveUser:async()=>{}} as never,
      fanto:service,records:{} as never,media});
    const request=()=>app.request(`/api/fanto?fantoId=${a.fantoId}`,{method:"DELETE",headers:{Authorization:"Bearer test","If-Match":String(changed.version)}});
    assert.equal((await request()).status,202);
    assert.deepEqual(closed,[a.sessionId]);
    await assert.rejects(service.get(user,a.fantoId),{code:"NOT_FOUND"});
    assert.equal((await memories.list(a.fantoId)).length,0);
    assert.equal((await memories.list(b.fantoId)).length,1);
    assert.equal((await memories.list(main.scopeKey)).length,1);
    assert.equal((await sql`SELECT 1 FROM records WHERE record_id=${userRecord}`.execute(db)).rows.length,1);
    assert.equal((await sql`SELECT 1 FROM records WHERE record_id=${record}`.execute(db)).rows.length,0);
    assert.equal((await sql`SELECT 1 FROM agent_session.entries WHERE session_id=${a.sessionId}`.execute(db)).rows.length,0);
    assert.equal((await sql`SELECT 1 FROM media_assets WHERE media_id=${avatar}`.execute(db)).rows.length,0);
    assert.equal((await sql`SELECT 1 FROM fanto_media_deletions WHERE fanto_id=${a.fantoId}`.execute(db)).rows.length,1);
    await assert.rejects(service.remove(other,{fantoId:a.fantoId,expectedVersion:changed.version}),{code:"NOT_FOUND"});
    fail=false;assert.equal((await request()).status,204);assert.deepEqual(removed,["role-avatar"]);
    assert.equal((await sql`SELECT 1 FROM fanto_media_deletions WHERE fanto_id=${a.fantoId}`.execute(db)).rows.length,0);
    assert.equal((await service.defaultSession(user)).sessionId,main.sessionId);
    await assert.rejects(service.reserveRun(user,a.sessionId,()=>()=>{}),{code:"NOT_FOUND"});
    const checkpoint=new CheckpointRepository(db);
    await assert.rejects(checkpoint.persist(a.sessionId,[{kind:"entry",runId:null,entry:{id:"late",parentId:null,type:"custom",customType:"late",data:{},timestamp:0} as never}]),/not found/);
    // Restart is role-scoped, drains checkpoints, and replaces rather than reuses the Session.
    await assert.rejects(service.restart(other,{fantoId:b.fantoId,expectedVersion:b.version}),{code:"NOT_FOUND"});
    running.add(b.sessionId);
    await assert.rejects(service.restart(user,{fantoId:b.fantoId,expectedVersion:b.version}),{code:"FANTO_BUSY"});
    running.delete(b.sessionId);
    closeFails=true;
    await assert.rejects(service.restart(user,{fantoId:b.fantoId,expectedVersion:b.version}),/checkpoint unavailable/);
    assert.equal((await service.get(user,b.fantoId)).sessionId,b.sessionId);
    assert.equal((await memories.list(b.fantoId)).length,1);
    closeFails=false;
    const restarted=await service.restart(user,{fantoId:b.fantoId,expectedVersion:b.version});
    assert.notEqual(restarted.sessionId,b.sessionId);
    assert.equal(restarted.version,b.version+1);
    assert.deepEqual(restarted.roleConfig,b.roleConfig);
    assert.deepEqual(restarted.agentConfig,b.agentConfig);
    assert.equal((await memories.list(b.fantoId)).length,0);
    assert.equal((await memories.list(main.scopeKey)).length,1);
    assert.equal((await sql`SELECT 1 FROM agent_session.sessions WHERE id=${b.sessionId}`.execute(db)).rows.length,0);
    assert.equal((await sql`SELECT 1 FROM agent_session.entries WHERE session_id=${b.sessionId}`.execute(db)).rows.length,0);
    await assert.rejects(service.reserveRun(user,b.sessionId,()=>()=>{}),{code:"NOT_FOUND"});
    await assert.rejects(service.restart(user,{fantoId:b.fantoId,expectedVersion:b.version}),{code:"VERSION_CONFLICT"});
    assert.equal((await service.get(user,b.fantoId)).sessionId,restarted.sessionId);
    const defaultRole=await service.get(user,main.scopeKey);
    const newDefault=await service.restart(user,{fantoId:defaultRole.fantoId,expectedVersion:defaultRole.version});
    assert.equal((await service.defaultSession(user)).sessionId,newDefault.sessionId);
    assert.notEqual(newDefault.sessionId,main.sessionId);
    assert.equal((await memories.list(main.scopeKey)).length,0);
    assert.equal((await sql`SELECT 1 FROM records WHERE record_id=${userRecord}`.execute(db)).rows.length,1);
  }finally{await db.destroy();await sql.raw("DROP DATABASE "+name+" WITH (FORCE)").execute(admin);await admin.destroy();}
});
