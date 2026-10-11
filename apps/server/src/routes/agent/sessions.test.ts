import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSessionRoutes } from "./sessions.js";
import { runWithRequestPrincipal } from "../request-user.js";
import { SessionOwnershipError } from "../../agent/harness/session-manager.js";
import { SessionEventBus } from "../../event/session-event-bus.js";

test("generic Session History reads Creator sessions by ownership without Project lookup",async()=>{
  const id=randomUUID();
  const sessions={
    history:async (requested:string,_cursor:number|undefined,_limit:number,userId:string)=>{
      if(requested!==id||userId!=="owner")throw new SessionOwnershipError();
      return {agentId:"creator-agent",entries:[],hasMore:false,nextCursor:null};
    },
    toolsForHistory:()=>[],
    assertOwnership:async(_requested:string,userId:string)=>{
      if(userId!=="owner")throw new SessionOwnershipError();
    }
  };
  const registry={get:(id:string)=>id==="creator-agent"?{id}:undefined};
  const app=createSessionRoutes(registry as never,sessions as never,new SessionEventBus());
  const request=(userId:string,path:string)=>runWithRequestPrincipal(
    {userId,source:"user"},()=>app.request(path));
  const allowed=await request("owner",`/sessions/${id}/history?limit=20`);
  assert.equal(allowed.status,200);
  const data=await allowed.json() as any;
  assert.equal(data.result.agentId,"creator-agent");
  assert.deepEqual(data.result.messages,[]);
  const forbidden=await request("different",`/sessions/${id}/history`);
  assert.equal(forbidden.status,403);
  const forbiddenEvents=await request("different",`/sessions/${id}/events`);
  assert.equal(forbiddenEvents.status,403);
});


test("Session creation allows all registered Agent identities without internal flags", async () => {
  const created: string[] = [];
  const registry = {get:(agentId?:string) => agentId && ["main","proposal-agent","creator-agent"].includes(agentId) ? {id:agentId} : undefined};
  const sessions = {create:async (definition:{id:string},userId:string)=>{assert.equal(userId,"owner");created.push(definition.id);return {id:randomUUID(),agentId:definition.id};}};
  const app = createSessionRoutes(registry as never,sessions as never);
  for (const agentId of ["main","proposal-agent","creator-agent"]) {
    const response = await runWithRequestPrincipal({userId:"owner",source:"user"}, () => app.request("/sessions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agentId})}));
    assert.equal(response.status,201);
  }
  assert.deepEqual(created,["main","proposal-agent","creator-agent"]);
});

test("stop returns unconfirmed within its deadline while durable cleanup remains pending",async()=>{
  let release!:()=>void,cleaned=false;
  const pending=new Promise<void>(resolve=>{release=()=>{cleaned=true;resolve();};});
  const sessions={assertOwnership:async()=>{},waitUntilIdle:()=>pending};
  const app=createSessionRoutes({} as never,sessions as never,undefined,15);
  const id=randomUUID();
  const response=await runWithRequestPrincipal({userId:"owner",source:"user"},()=>app.request(`/sessions/${id}/stop`,{method:"POST"}));
  assert.equal(response.status,503);assert.equal(cleaned,false);
  release();await pending;
  const confirmed=await runWithRequestPrincipal({userId:"owner",source:"user"},()=>app.request(`/sessions/${id}/stop`,{method:"POST"}));
  assert.equal(confirmed.status,200);
});

test("stop reports a cleanup failure honestly and preserves ownership errors",async()=>{
  for(const [error,status] of [[Error("database unavailable"),503],[new SessionOwnershipError(),403]] as const){
    const app=createSessionRoutes({} as never,{assertOwnership:async()=>{throw error;}} as never);
    const response=await runWithRequestPrincipal({userId:"owner",source:"user"},()=>app.request(`/sessions/${randomUUID()}/stop`,{method:"POST"}));
    assert.equal(response.status,status);
  }
});
