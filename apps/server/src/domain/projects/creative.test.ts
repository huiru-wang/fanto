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
