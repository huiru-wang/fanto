import test from "node:test";
import assert from "node:assert/strict";
import { imageInputSchema, projectManageSchema, isInternalAgent } from "./creative-model.js";

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
  assert.equal(isInternalAgent("creator-agent"),true);
  assert.equal(isInternalAgent("main"),false);
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
