import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AgentWorker } from "./agent-worker.js";
import { SessionEventBus } from "../event/session-event-bus.js";
import { createAgentRoutes } from "../routes/agent/stream.js";
import { runWithRequestPrincipal } from "../routes/request-user.js";

test("a timed-out worker releases its Session and the same Session accepts a chat turn", async () => {
  const id=randomUUID(), projectId=randomUUID();
  let busy=false, released=false, calls=0, abortSettled=false;
  let abortPrompt!:()=>void;
  const history:string[]=[];
  const session={id,userId:"user",agentId:"creator-agent",runtime:{
    tools:[],harness:{events:{on:()=>()=>{}}},readRecentMessages:async()=>[],
    abort:async()=>{abortPrompt();await new Promise(resolve=>setTimeout(resolve,30));abortSettled=true;},
    prompt:async(message:string)=>{
      history.push(message); calls++;
      if(calls===1) await new Promise<void>(resolve=>{abortPrompt=resolve;});
      return {ok:true,value:{status:"completed"}};
    },
  }};
  const sessions={
    reserve:()=>{assert.equal(busy,false);busy=true;return ()=>{busy=false;};},
    release:async()=>{assert.equal(abortSettled,true);released=true;},
    resolveAgentId:async()=>"creator-agent",acquire:async()=>session,
  };
  const events=new SessionEventBus();
  const terminal:string[]=[];
  events.subscribe(id,event=>{if(event.type==="done"||event.type==="error")terminal.push(event.type);});
  const worker=new AgentWorker(sessions as never,events);
  await assert.rejects(worker.run(session as never,"开始创作",20,{projectId},true,undefined,undefined,false),/abort/i);
  assert.equal(busy,false);assert.equal(released,true);assert.deepEqual(terminal,[]);
  const app=createAgentRoutes({get:()=>({id:"creator-agent"})} as never,sessions as never);
  const response=await runWithRequestPrincipal({userId:"user",source:"user"},()=>app.request("/stream",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:id,message:"继续创作",metadata:{projectId}}),
  }));
  assert.equal(response.status,200);assert.match(await response.text(),/event: done/);
  assert.deepEqual(history,["开始创作","继续创作"]);assert.equal(busy,false);
});
