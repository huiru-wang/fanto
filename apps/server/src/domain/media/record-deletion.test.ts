import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "../../infrastructure/database/database.js";
import { RecordService } from "../records/index.js";
import { RecordPostprocessQueue } from "../../event/record-postprocess-queue.js";
import { MediaService } from "./index.js";
import { ProjectService, ProposalService } from "../projects/index.js";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("Record deletion commits before one bounded OSS attempt, preserves final Project copy and user isolation", async () => {
  const admin=createDatabase(process.env.TEST_DATABASE_URL!);
  const name="delete_"+randomUUID().replaceAll("-","");
  await sql.raw(`CREATE DATABASE "${name}"`).execute(admin);
  const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname="/"+name;
  const db=createDatabase(url.href);
  const userId=randomUUID(),foreignId=randomUUID(),now=new Date();
  const objects=new Map<string,Buffer>();
  let fail=false,calls=0;
  const oss={
    remove:async(key:string)=>{calls++;if(fail)throw new Error("OSS unavailable");objects.delete(key);},
    getObject:async(key:string)=>objects.get(key)!,
    putObject:async(key:string,data:Buffer)=>{objects.set(key,data);}
  };
  const media=MediaService.create(db,oss as never);
  const records=RecordService.create(db,new RecordPostprocessQueue(),undefined,undefined,undefined,media);
  const embed={embed:async()=>Array.from({length:768},(_,i)=>i===0?1:0)};
  const projects=ProjectService.create(db,records,media,embed),proposals=ProposalService.create(db,records,media,embed);
  const make=async(owner=userId)=>{
    const id=randomUUID(),key=`users/${owner}/${id}.png`;
    objects.set(key,Buffer.from("image content"));
    await db.insertInto("media_assets").values({media_id:id,user_id:owner,object_key:key,media_type:"image",mime_type:"image/png",bytes:13,status:"ready",ext_data:"{}",created_at:now.toISOString(),updated_at:now.toISOString()}).execute();
    const created=await records.create(owner,{text:"园林记录",media:[{mediaId:id}],eventAt:now.toISOString()});
    assert.equal(created.kind,"ok");
    return {id,key,record:created.record};
  };
  try {
    await runMigrations(db);
    await db.insertInto("users").values([userId,foreignId].map(user_id=>({user_id,status:"active" as const,created_at:now,updated_at:now,disabled_at:null}))).execute();
    const first=await make(),foreign=await make(foreignId);
    assert.equal((await records.delete(foreignId,first.record.id,1)).kind,"not_found");
    assert.equal((await records.delete(userId,first.record.id,2)).kind,"conflict");
    assert.equal(calls,0);
    await sql`CREATE FUNCTION reject_record_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced rollback'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_record_delete BEFORE DELETE ON records FOR EACH ROW EXECUTE FUNCTION reject_record_delete();`.execute(db);
    await assert.rejects(records.delete(userId,first.record.id,1),/forced rollback/);
    assert.equal(calls,0);assert.ok(objects.has(first.key));
    await sql`DROP TRIGGER reject_record_delete ON records; DROP FUNCTION reject_record_delete();`.execute(db);
    fail=true;
    assert.equal((await records.delete(userId,first.record.id,1)).kind,"ok");
    assert.equal(await records.find(userId,first.record.id),null);
    assert.equal(await media.readyMetadata(userId,first.id),null);
    assert.ok(objects.has(first.key));assert.equal(calls,1);
    fail=false;
    const second=await make();
    const proposal=await proposals.create(userId,{type:"create",title:"园林",proposedSummary:"园林写真",recordIds:[second.record.id],content:{reason:"旅行",ideas:[{title:"园林画卷",idea:"把这次旅行绘制成一张温暖的记忆海报。",tags:["园林回忆","旅行画卷"],goal:{objective:"一页写真"}}]}});
    assert.equal(proposal.kind,"ok");
    const accepted=await proposals.accept(userId,proposal.data.proposalId);
    assert.equal(accepted.kind,"ok");
    const projectId=accepted.data.projectId;
    await db.updateTable("projects").set({status:"running"}).where("project_id","=",projectId).execute();
    assert.equal((await projects.update(userId,projectId,1,{content:`![园林](fanto-media://${second.id})`,coverMediaId:second.id})).kind,"ok");
    assert.equal((await records.delete(userId,second.record.id,1)).kind,"ok");
    assert.equal(objects.has(second.key),false);
    const published=await projects.find(userId,projectId);
    assert.ok(published?.coverMediaId&&published.coverMediaId!==second.id);
    assert.ok(published.content.includes(published.coverMediaId));
    const owned=await db.selectFrom("media_assets").selectAll().where("media_id","=",published.coverMediaId).executeTakeFirstOrThrow();
    assert.ok(owned.object_key.startsWith(`users/${userId}/project/${projectId}/`));
    assert.ok(objects.has(owned.object_key));
    assert.ok(objects.has(foreign.key));assert.equal(calls,2);
  }finally{
    await db.destroy();await sql.raw(`DROP DATABASE "${name}" WITH (FORCE)`).execute(admin);await admin.destroy();
  }
});
