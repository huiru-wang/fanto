import test from "node:test";
import assert from "node:assert/strict";
import { createRunContext } from "../run-context.js";
import { CreativeContextProvider } from "./creative-context.js";
import { CreationContextProvider } from "./creation-context.js";
import { TaskExecutionContextProvider } from "./task-execution.js";

function context(extra: Record<string, unknown> = {}) {
  return createRunContext({runId:"run", userId:"owner", sessionId:"session", query:"q", slots:{}, recentMessages:[], ...extra});
}

test("Proposal and Creator providers require disjoint server-authorized metadata", async () => {
  const calls: unknown[] = [];
  const client = {creativeContext: async (request: unknown) => {calls.push(request);return {allowed:true};}};
  const proposal = new CreativeContextProvider(client as never);
  const creator = new CreationContextProvider(client as never);
  await assert.rejects(proposal.build(context()), /CREATIVE_AUTHORITY_REQUIRED/);
  await assert.rejects(creator.build(context()), /CREATIVE_AUTHORITY_REQUIRED/);
  await assert.rejects(proposal.build(context({recordId:"r",recordVersion:1,projectId:"p"})),/CREATIVE_AUTHORITY_REQUIRED/);
  await assert.rejects(creator.build(context({projectId:"p",recordVersion:1})),/CREATIVE_AUTHORITY_REQUIRED/);
  await proposal.build(context({recordId:"r",recordVersion:1}));
  await creator.build(context({projectId:"p"}));
  assert.equal(calls.length,2);
});

test("Task Worker provider validates active TaskRun Session and restores plan gate", async () => {
  let runStatus = "running", sessionId = "session";
  const provider = new TaskExecutionContextProvider({
    getTaskExecution: async () => ({
      task:{taskId:"task",output:{format:"markdown"},references:{recordIds:[]}},
      run:{taskId:"task",runId:"run",workerSessionId:sessionId,status:runStatus,scheduledAt:"today",plan:{summary:"draft",steps:[]}},
    }),
  } as never);
  await assert.rejects(provider.build(context()),/TASK_AUTHORITY_REQUIRED/);
  const valid = context({task:{taskId:"task",taskRunId:"run"}});
  await provider.build(valid);
  assert.equal(createRunContext.read(valid).taskAuthorized,true);
  assert.equal(createRunContext.read(valid).taskPlanReady,true);
  sessionId="other";
  await assert.rejects(provider.build(context({task:{taskId:"task",taskRunId:"run"}})),/TASK_AUTHORITY_REQUIRED/);
  sessionId="session";runStatus="completed";
  await assert.rejects(provider.build(context({task:{taskId:"task",taskRunId:"run"}})),/TASK_AUTHORITY_REQUIRED/);
});
