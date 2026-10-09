import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSessionRoutes } from "./sessions.js";
import { runWithRequestPrincipal } from "../request-user.js";
import { SessionOwnershipError } from "../../agent/harness/session-manager.js";
import { SessionEventBus } from "../../event/session-event-bus.js";

test("generic Session History reads internal agent sessions by ownership without Project lookup",async()=>{
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
