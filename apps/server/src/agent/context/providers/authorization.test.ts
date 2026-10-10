import test from "node:test";
import assert from "node:assert/strict";
import { createRunContext } from "../run-context.js";
import { ProposalContextProvider } from "./proposal-context.js";
import { CreatorContextProvider } from "./creator-context.js";
import { TaskExecutionContextProvider } from "./task-execution.js";

function context(extra: Record<string, unknown> = {}) {
  return createRunContext({runId:"run", userId:"owner", sessionId:"session", query:"q", slots:{}, recentMessages:[], ...extra});
}

test("Proposal and Creator providers require disjoint server-authorized metadata", async () => {
  const calls: unknown[] = [];
  const client = {creativeContext: async (request: {recordId?: string}) => {
    calls.push(request);
    return request.recordId
      ? {sourceRecord: {recordId:request.recordId,content:{text:"一次新记录"}}, candidateProjects:{search:"lexical_recent_only",candidates:[]}}
      : {goal:{objective:"创作目标"},project:{projectId:"p",title:"作品",summary:"",status:"queued",version:1,content:""},
        records:{data:[],hasMore:false,nextCursor:null,pageSize:12}};
  }};
  const proposal = new ProposalContextProvider(client as never);
  const creator = new CreatorContextProvider(client as never);
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

test("Proposal and Creator prompts resolve structured source/project/goal/records with one authorized lookup", async () => {
  const { createSystemPrompt } = await import("../system-prompt.js");
  const { proposalAgentPrompt } = await import("../../prompts/proposal-agent.js");
  const { creatorAgentPrompt } = await import("../../prompts/creator-agent.js");
  const calls: Array<{recordId?:string;projectId?:string}> = [];
  const service = {creativeContext: async (input:{recordId?:string;projectId?:string}) => {
    calls.push(input);
    if (input.recordId) return {sourceRecord:{recordId:input.recordId,version:1,eventAt:"2026-10-08",content:{text:"我去旅行了",blocks:[]}},
      candidateProjects:{search:"semantic_lexical_recent",candidates:[{projectId:"p1",title:"旅行"}]}};
    return {goal:{objective:"红楼梦主题写真"},project:{projectId:"p1",title:"写真",summary:"照片",status:"running",version:3,content:"# 已有作品"},
      records:{data:[{id:"r1",eventAt:"2026-10-08T00:00:00Z",content:{text:"大观园照片",blocks:[{type:"image",mediaId:"media-1",description:"园林中的人物"}]}}],hasMore:false,nextCursor:null,pageSize:12}};
  }};
  const proposal = createSystemPrompt({template:proposalAgentPrompt,providers:[new ProposalContextProvider(service as never)]});
  const creator = createSystemPrompt({template:creatorAgentPrompt,providers:[new CreatorContextProvider(service as never)]});
  const proposalOutput=await proposal.resolve({} as never,context({recordId:"r0",recordVersion:1}));
  assert.match(proposalOutput,/我去旅行了/);
  assert.match(proposalOutput,/旅行/);
  assert.doesNotMatch(proposalOutput,/\{\{proposal_(record|projects)\}\}/);
  const creatorOutput=await creator.resolve({} as never,context({projectId:"p1"}));
  assert.match(creatorOutput,/红楼梦主题写真/);
  assert.match(creatorOutput,/# 已有作品/);
  assert.match(creatorOutput,/园林中的人物/);
  assert.match(creatorOutput,/media-1/);
  assert.doesNotMatch(creatorOutput,/\{\{creator_(goal|project|records)\}\}/);
  assert.equal(calls.length,2);
});
