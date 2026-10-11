import assert from "node:assert/strict";
import test from "node:test";
import { AgentHarness, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { MemorySessionRepo, operationState, operationToolArgs, branchTip, insertEntry, setValue } from "@earendil-works/pi-agent-core/harness/session";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createRunContext } from "../context/run-context.js";
import { projectHistory } from "../presentation.js";
import { clearInterruptedOperation } from "./build-runtime.js";

test("durable interrupted non-replayable tool is cancelled and the same lane accepts a new prompt", async () => {
  const repo=new MemorySessionRepo();
  const session=await repo.create({},TODO_CONTEXT);
  const models=builtinModels();
  const model=models.getModel("deepseek","deepseek-v4-pro")!;
  const {harness}=await AgentHarness.create({session,models,model,systemPrompt:"test",tools:[]},TODO_CONTEXT);
  const lane=await harness.lane("main",{createAt:null},TODO_CONTEXT);
  try {
    const admitted=await lane.accept({kind:"prompt",prompt:"old turn"},TODO_CONTEXT);
    assert.equal(admitted.ok,true); if(!admitted.ok)return;
    const operationId=admitted.value.operationId;
    const assistantEntryId="assistant-entry";
    const parentId=(await lane.inspectExecution(TODO_CONTEXT)).tipId;
    await session.mutate(async writer=>writer.commit([insertEntry({id:assistantEntryId,parentId,type:"message",message:{role:"assistant",content:[{type:"toolCall",id:"pending-tool",name:"image_generate",arguments:{}}],
      api:model.api,provider:model.provider,model:model.id,stopReason:"toolUse",timestamp:Date.now(),
      usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}}),setValue(branchTip("main"),assistantEntryId)],TODO_CONTEXT),TODO_CONTEXT);
    const stored=(await session.getValue(operationState(operationId),TODO_CONTEXT))!.value;
    const turnId="interrupted-turn";
    await session.setValue(operationState(operationId),{...stored,at:"tools",batch:{turnId,assistantEntryId,
      configuration:{model:{provider:model.provider,modelId:model.id},activeToolNames:["image_generate"]},
      calls:[{status:"effect_pending",sourceIndex:0,resultEntryId:"pending-result",replay:"never"}]},latestAssistantEntryId:assistantEntryId} as never,TODO_CONTEXT);
    await session.setValue(operationToolArgs(operationId,turnId,0),{},TODO_CONTEXT);
    await harness.close(TODO_CONTEXT);
    const restoredSession=await repo.open(session.metadata,TODO_CONTEXT);
    const reopened=await AgentHarness.create({session:restoredSession,models,model,systemPrompt:"test",tools:[]},TODO_CONTEXT);
    const restoredLane=await reopened.harness.lane("main",{createAt:null},TODO_CONTEXT);
    const blocked=await restoredLane.accept({kind:"prompt",prompt:"new turn"},TODO_CONTEXT);
    assert.equal(blocked.ok,false);if(!blocked.ok)assert.equal(blocked.error._tag,"LaneBusy");
    const context=createRunContext({runId:"test",sessionId:session.metadata.id,userId:"user",query:"new turn",slots:{},recentMessages:[]});
    await clearInterruptedOperation(restoredLane,context);
    assert.equal((await restoredLane.inspectExecution(TODO_CONTEXT)).current,null);
    const entries=await restoredLane.findEntries({type:"message",order:"newestFirst",limit:1},TODO_CONTEXT);
    assert.equal(entries[0]?.type,"message");
    if(entries[0]?.type==="message")assert.equal(entries[0].message.role,"toolResult");
    assert.equal(projectHistory(await restoredLane.findEntries({order:"newestFirst"},TODO_CONTEXT),[]).at(-1)?.state,"stopped");
    const next=await restoredLane.accept({kind:"prompt",prompt:"new turn"},TODO_CONTEXT);
    assert.equal(next.ok,true);
    await restoredLane.abort(TODO_CONTEXT);
    await reopened.harness.close(TODO_CONTEXT);
  } finally {await repo.close(TODO_CONTEXT);}
});
