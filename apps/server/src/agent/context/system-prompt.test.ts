import assert from "node:assert/strict";
import test from "node:test";
import { createRunContext } from "./run-context.js";
import { createSystemPrompt } from "./system-prompt.js";

function run() {
  return createRunContext({runId:"r",userId:"u",sessionId:"s",query:"q",slots:{},recentMessages:[]});
}

test("one authorized provider resolves multiple semantic prompt slots exactly once per run", async () => {
  let calls = 0;
  const prompt = createSystemPrompt({
    template:"Goal:\n{{test_goal}}\nRecords:\n{{test_records}}\nGoal again: {{test_goal}}",
    providers:[{slots:["test_goal","test_records"],required:true,async build() {
      calls++;
      return {test_goal:"写一本书",test_records:"record A; record B"};
    }}],
  });
  const context = run();
  const first = await prompt.resolve({} as never,context);
  assert.match(first,/Goal:\n写一本书\nRecords:\nrecord A; record B/);
  assert.match(first,/Goal again: 写一本书/);
  assert.equal(calls,1);
  assert.equal(await prompt.resolve({} as never,context),first);
  assert.equal(calls,1);
  prompt.release(context);
  await prompt.resolve({} as never,context);
  assert.equal(calls,2);
});

test("multi-slot providers validate all declared slots and preserve required errors", async () => {
  const bad = createSystemPrompt({template:"{{a}}/{{b}}",providers:[{
    slots:["a","b"],required:true,async build() {return {a:"A"};},
  }]});
  await assert.rejects(bad.resolve({} as never,run()),/Provider omitted context slot: b/);
  assert.throws(()=>createSystemPrompt({template:"{{a}}",providers:[
    {slot:"a",async build(){return {slot:"a",content:"a"};}},
    {slots:["a","b"],async build(){return {a:"a",b:"b"};}},
  ]}),/Duplicate context slot provider: a/);
});

test("original single-slot providers and optional fallback remain compatible", async () => {
  const prompt = createSystemPrompt({template:"{{character}} / {{unknown}}",providers:[{
    slot:"character",async build(){return {slot:"character",content:"Fanto"};},
  }]});
  assert.equal(await prompt.resolve({} as never,run()),"Fanto / （无）");
});

test("main prompt resolves only dynamic role context and external time slots", async () => {
  const { mainPrompt } = await import("../prompts/main.js");
  const slots = [...mainPrompt.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map(match => match[1]);
  assert.deepEqual(slots, ["dynamic_main","current_time"]);
  assert.doesNotMatch(mainPrompt, /recent_records|memory_manage/);
  assert.doesNotMatch(mainPrompt, /fantoCore/);
});

test("main prompt prioritizes roleplay, character agency and narrative time instead of life coaching", async () => {
  const { mainPrompt } = await import("../prompts/main.js");
  assert.match(mainPrompt,/角色扮演核心/);
  assert.match(mainPrompt,/角色身份与自主性/);
  assert.match(mainPrompt,/叙事与互动/);
  assert.match(mainPrompt,/世界连续性与视角/);
  assert.match(mainPrompt,/故事时间与现实时间/);
  assert.match(mainPrompt,/外部现实时间参考（不是故事时间）/);
  assert.match(mainPrompt,/用户明确提出角色扮演之外的设定讨论/);
  assert.doesNotMatch(mainPrompt,/苏格拉底式|服务于用户的人生|必须以 Dynamic Context/);
});
