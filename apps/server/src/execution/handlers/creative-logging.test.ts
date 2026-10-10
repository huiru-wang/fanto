import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const logDir = mkdtempSync(join(tmpdir(), "fanto-creative-logs-"));
process.env.LOG_DIR = logDir;
const { ProposalHandler } = await import("./proposal.handler.js");
const { CreatorHandler } = await import("./creator.handler.js");
const { logSummary } = await import("../../infrastructure/logging/logger.js");
after(() => rmSync(logDir, { recursive: true, force: true }));
const logs = () => readFileSync(join(logDir, "service.log"), "utf8").trim().split("\n").map(line => {
  const match = line.match(/^\[[^\]]+\] \[[^\]]+\] \[([^\]]+)\] (.*?) (\{.*\})$/)!;
  return { scope: match[1], event: match[2], ...JSON.parse(match[3]) };
});

test("Proposal logs distinguish no-proposal, stale records and failed runs with correlation", async () => {
  let version = 1;
  let response = JSON.stringify({decision:"no_proposal",reason:"没有新增变化"});
  const handler = new ProposalHandler(
    {findMany:async()=>[{version,status:"processed"}]} as never,
    {findBySession:async()=>null} as never,
    {registry:{get:()=>({})},sessions:{create:async()=>({id:"proposal-session"})}} as never,
    {run:async()=>{
      const binding=logs().at(-1);
      assert.equal(binding.event,"session created");
      assert.equal(binding.recordId,"record");
      assert.equal(binding.sessionId,"proposal-session");
      return response;
    }} as never, 1000);
  await handler.execute("user", "record", 1);
  const decision = logs().find(e=>e.scope==="proposal"&&e.event==="decision");
  assert.equal(decision.decision,"no_proposal");
  assert.equal(decision.reason,"没有新增变化");
  assert.equal(decision.sessionId,"proposal-session");
  assert.equal(decision.recordId,"record");
  assert.equal(decision.userId,"user");
  assert.equal(typeof decision.durationMs,"number");
  version=2;
  await handler.execute("user","record",1);
  assert.equal(logs().at(-1).reason,"record_version_changed");
  version=1; response="invalid decision";
  await assert.rejects(handler.execute("user","record",1),/PROPOSAL_DECISION_INVALID/);
  const failed=logs().at(-1);
  assert.equal(failed.event,"failed");
  assert.equal(failed.stage,"validate_decision");
  assert.equal(failed.sessionId,"proposal-session");
});

test("Creator logs reference records and saved versions, and identifies an unsaved result", async () => {
  let version=1;
  let save=true;
  const statuses:string[]=[];
  const handler=new CreatorHandler(
    {find:async()=>({sessionId:"creator-session",version}),claimExecution:async()=>true,
      finishExecution:async(_u:string,_p:string,status:string)=>{statuses.push(status);}} as never,
    {find:async()=>({status:"accepted",resultProjectId:"project",type:"create",content:{selectedIdeaId:"idea",ideas:[{id:"idea",goal:{},title:"title",idea:"idea"}]}}),
      recordsPage:async()=>({kind:"ok",data:{data:[{id:"record-a"},{id:"record-b"}]}})} as never,
    {registry:{get:()=>({})},sessions:{acquire:async()=>({id:"creator-session",session:{findEntries:async()=>[]},runtime:{appendCustomEntry:async()=>{}}})}} as never,
    {run:async(_s:unknown,_m:unknown,_t:unknown,_meta:unknown,_e:unknown,_signal:unknown,completed:()=>Promise<void>)=>{if(save)version++;await completed();}} as never,1000);
  await handler.execute("user","project","proposal");
  const completed=logs().find(e=>e.scope==="creator"&&e.event==="completed");
  const binding=logs().find(e=>e.scope==="creator"&&e.event==="execution session bound");
  assert.equal(binding.proposalId,"proposal");
  assert.equal(binding.projectId,"project");
  assert.equal(binding.sessionId,"creator-session");
  assert.deepEqual(completed.recordIds,["record-a","record-b"]);
  assert.equal(completed.proposalId,"proposal");
  assert.equal(completed.sessionId,"creator-session");
  assert.equal(completed.initialVersion,1);
  assert.equal(completed.savedVersion,2);
  save=false;
  await assert.rejects(handler.execute("user","project","proposal"),/CREATOR_RESULT_NOT_SAVED/);
  const failed=logs().at(-1);
  assert.equal(failed.scope,"creator");
  assert.equal(failed.stage,"validate_result");
  assert.equal(failed.error,"CREATOR_RESULT_NOT_SAVED");
  assert.deepEqual(statuses,["completed","failed"]);
});

test("Decision/error summaries redact credentials and URLs and remain bounded", () => {
  const summary=logSummary(new Error("token=private Bearer credential https://example.com/?secret=hidden"));
  assert.ok(!summary.includes("private"));
  assert.ok(!summary.includes("credential"));
  assert.ok(!summary.includes("hidden"));
  assert.equal(logSummary("a".repeat(2000)).length,1000);
});

test("Accept logs distinguish first acceptance, duplicates and rejection without redispatch", async () => {
  const {createProposalRoutes}=await import("../../routes/projects.js");
  const {runWithRequestPrincipal}=await import("../../routes/request-user.js");
  const {AgentExecutionQueue}=await import("../../event/agent-execution-queue.js");
  const queue=new AgentExecutionQueue();
  const dispatched:unknown[]=[];
  queue.on(async message=>{dispatched.push(message);});
  let firstAccepted=true;
  let rejected=false;
  const app=createProposalRoutes({accept:async()=>rejected?{kind:"error",code:"INVALID_STATE"}:{kind:"ok",data:{projectId:"project",firstAccepted}}} as never,queue);
  const request=()=>runWithRequestPrincipal({userId:"user",source:"user"},()=>app.request("/proposals/proposal/accept",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}));
  assert.equal((await request()).status,200);
  firstAccepted=false;
  assert.equal((await request()).status,200);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dispatched.length,1);
  const accepted=logs().filter(e=>e.scope==="proposal"&&e.event==="accepted");
  assert.deepEqual(accepted.map(e=>e.firstAccepted),[true,false]);
  assert.ok(logs().some(e=>e.scope==="agent-execution"&&e.event==="queued"&&e.proposalId==="proposal"&&e.projectId==="project"));
  rejected=true;
  assert.equal((await request()).status,409);
  assert.equal(logs().at(-1).errorCode,"INVALID_STATE");
});
