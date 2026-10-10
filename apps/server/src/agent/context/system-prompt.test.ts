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
    template:"Goal:\n{{creator_goal}}\nRecords:\n{{creator_records}}\nGoal again: {{creator_goal}}",
    providers:[{slots:["creator_goal","creator_records"],required:true,async build() {
      calls++;
      return {creator_goal:"写一本书",creator_records:"record A; record B"};
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
