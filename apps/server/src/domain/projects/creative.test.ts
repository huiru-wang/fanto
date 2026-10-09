import test from "node:test";
import assert from "node:assert/strict";
import { imageInputSchema, projectManageSchema } from "./creative-model.js";

test("image_generate accepts multiple references and produces one image per call without run state", () => {
  const input = {prompt:"保留原始场景，绘制新风格",referenceMediaIds:[
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"],aspectRatio:"portrait" };
  assert.equal(imageInputSchema.safeParse(input).success,true);
  assert.equal(imageInputSchema.safeParse({...input,imageIndex:1}).success,false);
  assert.equal(imageInputSchema.safeParse({...input,referenceMediaIds:[]}).success,false);
});

test("project_manage updates goal and complete content independently", () => {
  const input={action:"update",projectId:"11111111-1111-4111-8111-111111111111",expectedVersion:2,
    goal:{objective:"写一首诗"},content:"# 新作品"};
  assert.equal(projectManageSchema.safeParse(input).success,true);
  assert.equal(projectManageSchema.safeParse({...input,creationRunId:"unused"}).success,false);
});

import { CreativeService } from "./creative-service.js";

test("new generated media cannot be published without an actual image review", async () => {
  const projectId="11111111-1111-4111-8111-111111111111";
  const mediaId="22222222-2222-4222-8222-222222222222";
  const context={userId:"user-1",sessionId:"session-1",projectId};
  const project={projectId,sessionId:"session-1",content:"",goal:{objective:"照片画册"},version:2};
  let reviewedAt:string|undefined;
  let updated=0;
  const service=new CreativeService({} as never, {} as never,
    {find:async()=>project,update:async()=>{updated++;return {kind:"ok",data:project};}} as never,
    {} as never,
    {findOwnedByIds:async()=>[{mediaId,extData:{createdBy:"image_generate",requiresReview:true,reviewedAt}}]} as never,
    {} as never,async()=>({}));
  const input={action:"update" as const,projectId,expectedVersion:2,content:`![作品](fanto-media://${mediaId})`};
  await assert.rejects(service.projectManage(context,input),/IMAGE_REVIEW_REQUIRED/);
  assert.equal(updated,0);
  reviewedAt="2026-10-09T00:00:00Z";
  await service.projectManage(context,input);
  assert.equal(updated,1);
});


test("Archived Project and cross-session Project are not authorized for tools", async () => {
  const projectId="11111111-1111-4111-8111-111111111111";
  let status = "archived";
  const service = new CreativeService({} as never, {} as never,
    { find: async () => ({ projectId, sessionId: "session-1", status, content: "", version: 1 }) } as never,
    {} as never, {} as never, {} as never, async () => ({}));
  const context = {userId:"user-1",sessionId:"session-1",projectId};
  await assert.rejects(service.context(context), /PROJECT_ARCHIVED/);
  status = "completed";
  await assert.rejects(service.context({...context,sessionId:"session-2"}), /PROJECT_NOT_AUTHORIZED/);
  await assert.rejects(service.context({...context,recordId:"record-1",recordVersion:1}), /PROJECT_CONTEXT_REQUIRED|CREATIVE_AUTHORITY_REQUIRED/);
});

test("CreativeService restores failed Project only through an authorized successful Creator save", async () => {
  const projectId="11111111-1111-4111-8111-111111111111";
  const context={userId:"user-1",sessionId:"session-1",projectId};
  let completeFailedOnSave = false;
  const service = new CreativeService({} as never, {} as never,
    {find:async()=>({projectId,sessionId:context.sessionId,status:"failed",version:2,content:"# 旧内容"}),
      update:async (_userId:string,_projectId:string,_version:number,_patch:unknown, options:{completeFailedOnSave?:boolean})=>{
        completeFailedOnSave = options.completeFailedOnSave === true;
        return {kind:"ok",data:{projectId,status:"completed"}};
      }} as never,
    {} as never, {findOwnedByIds:async()=>[]} as never, {} as never,async()=>({}));
  await service.projectManage(context,{action:"update",projectId,expectedVersion:2,content:"# 已恢复"});
  assert.equal(completeFailedOnSave,true);
});
