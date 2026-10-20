import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSessionRoutes } from "./sessions.js";
import { runWithRequestPrincipal } from "../request-user.js";
import { SessionOwnershipError } from "../../agent/harness/session-manager.js";

test("Main Session History enforces ownership",async()=>{
  const id=randomUUID();
  let running = true;
  const sessions={
    isRunning: () => running,
    history:async (requested:string,_cursor:number|undefined,_limit:number,userId:string)=>{
      if(requested!==id||userId!=="owner")throw new SessionOwnershipError();
      return {agentId:"main",entries:[],hasMore:false,nextCursor:null};
    },
    toolsForHistory:()=>[],
    assertOwnership:async(_requested:string,userId:string)=>{
      if(userId!=="owner")throw new SessionOwnershipError();
    }
  };
  const registry={get:(id:string)=>id==="main"?{id}:undefined};
  const app=createSessionRoutes(registry as never,sessions as never);
  const request=(userId:string,path:string)=>runWithRequestPrincipal(
    {userId,source:"user"},()=>app.request(path));
  const allowed=await request("owner",`/sessions/${id}/history?limit=20`);
  assert.equal(allowed.status,200);
  const data=await allowed.json() as any;
  assert.equal(data.result.agentId,"main");
  assert.deepEqual(data.result.messages,[]);
  assert.equal(data.result.running,true);
  running = false;
  assert.equal(((await (await request("owner", `/sessions/${id}/history`)).json()) as any).result.running, false);
  const forbidden=await request("different",`/sessions/${id}/history`);
  assert.equal(forbidden.status,403);
  const forbiddenEvents=await request("different",`/sessions/${id}/events`);
  assert.equal(forbiddenEvents.status,404);
});


test("Session creation is disabled; default Main resolves idempotently", async () => {
  const app=createSessionRoutes({} as never,{defaultMain:async(userId:string)=>{
    assert.equal(userId,"owner");return {sessionId:"fixed",agentId:"main",scopeKey:"default"};
  }} as never);
  for(const agentId of ["main","creator-agent","proposal-agent"]){
    const response=await runWithRequestPrincipal({userId:"owner",source:"user"},()=>app.request("/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agentId})}));
    assert.equal(response.status,403);
  }
  const result=await runWithRequestPrincipal({userId:"owner",source:"user"},()=>app.request("/main-session"));
  assert.equal(result.status,200);assert.equal((await result.json() as any).result.scopeKey,"default");
});

test("stop without an active run is idempotent and does not wait on persistence",async()=>{
  const sessions={assertOwnership:async()=>{},isRunning:()=>false};
  const app=createSessionRoutes({} as never,sessions as never);
  const id=randomUUID();
  const response=await runWithRequestPrincipal({userId:"owner",source:"user"},()=>app.request(`/sessions/${id}/stop`,{method:"POST"}));
  assert.equal(response.status,200);
  assert.deepEqual((await response.json() as any).result,{sessionId:id,stopped:false,stopping:false});
});

test("stop reports a cleanup failure honestly and preserves ownership errors",async()=>{
  for(const [error,status] of [[Error("database unavailable"),503],[new SessionOwnershipError(),403]] as const){
    const app=createSessionRoutes({} as never,{assertOwnership:async()=>{throw error;}} as never);
    const response=await runWithRequestPrincipal({userId:"owner",source:"user"},()=>app.request(`/sessions/${randomUUID()}/stop`,{method:"POST"}));
    assert.equal(response.status,status);
  }
});
