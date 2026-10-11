import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createSessionRoutes } from "./sessions.js";
import { runWithRequestPrincipal } from "../request-user.js";
import { AgentSessionManager, SessionOwnershipError } from "../../agent/harness/session-manager.js";
import { runAgent } from "../../agent/harness/run.js";

test("stop checks ownership before cancellation and waits for Session release", async () => {
  const id=randomUUID();
  const manager=Object.create(AgentSessionManager.prototype) as AgentSessionManager;
  Object.assign(manager,{running:new Set(),idleWaiters:new Map(),assertOwnership:async(_:string,user:string)=>{
    if(user!=="owner")throw new SessionOwnershipError("wrong user");
  }});
  let admitted!:()=>void, complete!:()=>void, aborted=false;
  const ready=new Promise<void>(resolve=>{admitted=resolve;});
  const session={id,userId:"owner",runtime:{tools:[],harness:{events:{on:()=>()=>{}}},readRecentMessages:async()=>[],
    prompt:async()=>{admitted();await new Promise<void>(resolve=>{complete=resolve;});return {ok:true,value:{status:"completed"}};},
    abort:async()=>{aborted=true;complete();await new Promise(resolve=>setTimeout(resolve,20));},
  }};
  const release=manager.reserve(session as never);
  const run=runAgent(session as never,"hello",new AbortController().signal,{},async()=>{});
  const settled=assert.rejects(run,{name:"AbortError"}).then(async()=>{await new Promise(resolve=>setTimeout(resolve,20));release();});
  await ready;
  const app=createSessionRoutes({} as never,manager);
  const request=(user:string,path:string=id)=>runWithRequestPrincipal({userId:user,source:"user"},()=>app.request(`/sessions/${path}/stop`,{method:"POST"}));
  assert.equal((await request("foreign")).status,403);assert.equal(aborted,false);
  assert.equal((await request("owner","invalid")).status,400);
  const response=await request("owner");
  assert.equal(response.status,200);assert.equal((manager as any).running.size,0);
  assert.equal(((await response.json()) as {result:{stopped:boolean}}).result.stopped,true);
  await settled;
  assert.equal(((await (await request("owner")).json()) as {result:{stopped:boolean}}).result.stopped,false);
});
