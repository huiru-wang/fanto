import assert from "node:assert/strict";
import test from "node:test";
import { AgentHarness, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { createRunContext } from "../context/run-context.js";
import { runAgent, stopAgentRun } from "./run.js";
import { projectHistory } from "../presentation.js";
import { cancelLaneOperation } from "./build-runtime.js";
import type { HarnessRuntime } from "./build-runtime.js";

for (const [agentId, stopBeforeText] of [["main", false], ["creator-agent", false], ["proposal-agent", false], ["task-worker", false], ["main", true]] as const) {
  test(`${agentId}: stopping ${stopBeforeText ? "before text" : "during streaming"} persists history and accepts another turn`, async () => {
    const repo = new MemorySessionRepo();
    const session = await repo.create({}, TODO_CONTEXT);
    const faux = fauxProvider({tokensPerSecond: 100, tokenSize:{min:1,max:1}});
    faux.setResponses([fauxAssistantMessage("a".repeat(500)), fauxAssistantMessage("continued")]);
    const models = createModels();models.setProvider(faux.provider);
    const {harness} = await AgentHarness.create({session,models,model:faux.getModel(),systemPrompt:"test",tools:[]},TODO_CONTEXT);
    const lane = await harness.lane("main",{createAt:null},TODO_CONTEXT);
    let context: Parameters<HarnessRuntime["prompt"]>[1];
    const runtime: HarnessRuntime = {
      harness:harness as HarnessRuntime["harness"],tools:[],readRecentMessages:async()=>[],
      prompt:async(query,ctx)=>{context=ctx;return lane.prompt(query,undefined,ctx);},
      abort:()=>cancelLaneOperation(lane,context),
      appendCustomEntry:(type,data)=>lane.appendCustomEntry(type,data,TODO_CONTEXT),
      close:()=>harness.close(TODO_CONTEXT),
    };
    try {
      if (agentId === "main" && !stopBeforeText) {
        faux.setResponses([fauxAssistantMessage("",{stopReason:"error",errorMessage:"provider unavailable"}),fauxAssistantMessage("a".repeat(500)),fauxAssistantMessage("continued")]);
        await assert.rejects(runAgent({id:session.metadata.id,userId:"user",agentId,runtime},"failed request",new AbortController().signal,{},async()=>{}),/AGENT_RUN_NOT_COMPLETED:failed/);
      }
      let firstDelta!:()=>void;
      const started = new Promise<void>(resolve=>{firstDelta=resolve;});
      const turn = runAgent({id:session.metadata.id,userId:"user",agentId,runtime},"first",new AbortController().signal,{},async event=>{
        if(event.type===(stopBeforeText ? "message_start" : "delta"))firstDelta();
      });
      const rejected=assert.rejects(turn,{name:"AbortError"});
      await started;
      assert.equal(await stopAgentRun(session.metadata.id),true);
      await rejected;
      assert.equal((await lane.inspectExecution(TODO_CONTEXT)).current,null);
      const entries=await lane.findEntries({order:"newestFirst"},TODO_CONTEXT);
      const messages=projectHistory(entries,[]).slice(-2);
      assert.equal(messages[0]?.role,"user");
      assert.equal(messages[1]?.state,"stopped");
      if (!stopBeforeText) assert.ok(messages[1]?.blocks.some(block=>block.type==="text" && block.content.length>0));
      const result=await runAgent({id:session.metadata.id,userId:"user",agentId,runtime},"next",new AbortController().signal,{},async()=>{});
      assert.equal(result,"continued");
      assert.equal(await stopAgentRun(session.metadata.id),false);
    } finally {await harness.close(TODO_CONTEXT);await repo.close(TODO_CONTEXT);}
  });
}


test("stopping a live tool preserves cancellation results and the next turn succeeds", async () => {
  const repo=new MemorySessionRepo();const session=await repo.create({},TODO_CONTEXT);
  const faux=fauxProvider();const models=createModels();models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage(fauxToolCall("slow_tool",{})),fauxAssistantMessage("next answer")]);
  let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
  let effects=0;
  const tool={name:"slow_tool",label:"slow",description:"test",parameters:Type.Object({}),replay:"never" as const,
    execute:async(_id:unknown,_args:unknown,_update:unknown,_toolContext:unknown,_invocation:unknown,context:any)=>{
      effects++;started();
      await new Promise<void>(resolve=>context.abortSignal.addEventListener("abort",resolve,{once:true}));
      context.abortSignal.throwIfAborted();
      return {content:[{type:"text" as const,text:"finished"}],details:{}};
    }};
  const {harness}=await AgentHarness.create({session,models,model:faux.getModel(),tools:[tool],systemPrompt:"test"},TODO_CONTEXT);
  const lane=await harness.lane("main",{createAt:null},TODO_CONTEXT);
  let context: Parameters<HarnessRuntime["prompt"]>[1];
  harness.hooks.on("before_run_end",(_event,ctx)=>{assert.equal(createRunContext.read(ctx).userId,"owner");return undefined;});
  const runtime={harness,tools:[],readRecentMessages:async()=>[],prompt:async(query:string,ctx:any)=>{context=ctx;return lane.prompt(query,undefined,ctx);},
    abort:()=>cancelLaneOperation(lane,context),appendCustomEntry:(type:string,data:any)=>lane.appendCustomEntry(type,data,TODO_CONTEXT),close:()=>harness.close(TODO_CONTEXT)} as unknown as HarnessRuntime;
  const managed={id:session.metadata.id,userId:"owner",runtime};
  try {
    const turn=runAgent(managed,"tool turn",new AbortController().signal,{},async()=>{});
    const rejected=assert.rejects(turn,{name:"AbortError"});await ready;
    await stopAgentRun(managed.id);await rejected;
    const entries=await lane.findEntries({order:"newestFirst"},TODO_CONTEXT);
    assert.ok(entries.some(entry=>entry.type==="message"&&entry.message.role==="toolResult"&&entry.message.isError));
    assert.equal(projectHistory(entries,[]).at(-1)?.state,"stopped");
    assert.equal(await runAgent(managed,"next",new AbortController().signal,{},async()=>{}),"next answer");
    assert.equal(effects,1);
  }finally {await harness.close(TODO_CONTEXT);await repo.close(TODO_CONTEXT);}
});
