import assert from "node:assert/strict";
import test from "node:test";
import { CreatorHandler } from "./creator.handler.js";
import { ProposalHandler } from "./proposal.handler.js";

const id = "11111111-1111-4111-8111-111111111111";
const recordId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";

test("Proposal handler recognizes valuable no-proposal decisions without conflating them with agent failures", async () => {
  let response = JSON.stringify({ decision: "no_proposal", reason: "记录重复已有内容，没有新增变化" });
  const records = { findMany: async () => [{ id: recordId, version: 1, status: "processed" }] };
  const agent = { registry: { get: () => ({id:"proposal-agent"}) }, sessions: {create: async () => ({id})} };
  const proposals = {findBySession: async () => null};
  const worker = {run: async () => response};
  const handler = new ProposalHandler(records as never,proposals as never,agent as never,worker as never,60000);
  await handler.execute(id,recordId,1);
  response = "我不确定，先不提议";
  await assert.rejects(handler.execute(id,recordId,1),/PROPOSAL_DECISION_INVALID/);
});

test("Creator receives the accepted Extend change and does not silently replace the original goal", async () => {
  const messages:string[] = [];
  const statuses:string[] = [];
  let version=5;
  const project = () => ({projectId,sessionId:id,version,goal:{objective:"既有职业反思札记"},status:"queued"});
  const projects = {
    find: async () => project(),
    claimExecution: async () => true,
    finishExecution: async (_u:string,_p:string,status:string) => {statuses.push(status);},
  };
  const proposals = {recordsPage:async()=>({kind:"ok",data:{data:[{id:recordId}]}}),find:async () => ({status:"accepted",resultProjectId:projectId,type:"extend",content:{selectedIdeaId:id,
    ideas:[{id,title:"增加一次求职反例",idea:"新增经历反驳原先过度乐观的判断",goal:project().goal}],
    change:{kind:"correct",title:"增加一次求职反例",instruction:"保留原文，仅纠正经验归纳的片面性"}}})};
  let entries: any[] = [];
  const runtime = {appendCustomEntry:async (type:string,data:unknown) => {entries.push({type:"custom",customType:type,data});}};
  const agent = {registry:{get:() => ({id:"creator-agent"})},sessions:{
    release:async()=>{},acquire:async () => ({id,session:{findEntries:async () => entries},runtime}),
  }};
  const worker={run:async (_session:unknown,message:string,_timeout:unknown,_meta:unknown,_events:unknown,_signal:unknown,onCompleted:()=>Promise<void>) => {messages.push(message);version++;await onCompleted();return "done";}};
  const handler = new CreatorHandler(projects as never,proposals as never,agent as never,worker as never,60000);
  await handler.execute(id,projectId,id);
  assert.match(messages[0]!,/职业|求职/);
  assert.match(messages[0]!,/保留原有 goal/);
  assert.match(messages[0]!,/保留原文，仅纠正/);
  assert.match(messages[0]!,/22222222-2222/);
  assert.deepEqual(statuses,["completed"]);
  assert.equal(entries.find(e=>e.customType==="fanto.proposal_applied")?.data?.proposalId,id);
  await handler.execute(id,projectId,id);
  assert.equal(messages.length,1,"An applied proposal must not run again");
});

test("An unsuccessful creator run cannot be marked as applied and can be retried", async () => {
  let attempts=0;let version=3; const entries:any[]=[]; const statuses:string[]=[];
  const projects={find:async () => ({projectId,sessionId:id,version,status:"queued"}),claimExecution:async () => true,
    finishExecution:async (_u:string,_p:string,status:string)=>{statuses.push(status);}};
  const proposals={recordsPage:async()=>({kind:"ok",data:{data:[{id:recordId}]}}),find:async () => ({status:"accepted",type:"create",resultProjectId:projectId,
    content:{selectedIdeaId:id,ideas:[{id,title:"一页深度思考",idea:"对照两种解释",goal:{objective:"写有依据的札记"}}]}})};
  const agent={registry:{get:()=>({id:"creator-agent"})},sessions:{acquire:async()=>({id,session:{findEntries:async()=>entries},runtime:{appendCustomEntry:async(type:string,data:unknown)=>{entries.push({type:"custom",customType:type,data});}}})}};
  const worker={run:async (_s:unknown,_m:unknown,_t:unknown,_meta:unknown,_e:unknown,_signal:unknown,onCompleted:()=>Promise<void>)=>{attempts++;if(attempts===1)throw Error("vision unavailable");version++;await onCompleted();return "ok";}};
  const handler=new CreatorHandler(projects as never,proposals as never,agent as never,worker as never,60000);
  await assert.rejects(handler.execute(id,projectId,id),/vision unavailable/);
  assert.equal(entries.length,0);
  await handler.execute(id,projectId,id);
  assert.equal(attempts,2);
  assert.deepEqual(statuses,["failed","completed"]);
});
