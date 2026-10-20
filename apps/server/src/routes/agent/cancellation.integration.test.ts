import assert from "node:assert/strict";
import test from "node:test";
import type {Server} from "node:http";
import {serve} from "@hono/node-server";
import {Hono} from "hono";
import { AgentHarness, TODO_CONTEXT, type Context } from "@earendil-works/pi-agent-core";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { createModels } from "@earendil-works/pi-ai";
import {Type} from "typebox";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createAgentRoutes } from "./stream.js";
import { createSessionRoutes } from "./sessions.js";
import { runWithRequestPrincipal } from "../request-user.js";
import { AgentSessionManager } from "../../agent/harness/session-manager.js";
import { cancelLaneOperation } from "../../agent/harness/build-runtime.js";
import { installStopHooks } from "../../agent/harness/stop-state.js";
import { runAgent, stopAgentRun } from "../../agent/harness/run.js";


async function deadline<T>(promise: Promise<T>, ms = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("cancellation blocked by output")),ms);})]);}
  finally {clearTimeout(timer!);}
}

async function fixture(timeoutMs?:number, stopTimeoutMs?:number, withTool=false) {
  const repo = new MemorySessionRepo();
  const stored = await repo.create({},TODO_CONTEXT);
  const faux = fauxProvider({tokensPerSecond:100,tokenSize:{min:1,max:1}});
  faux.setResponses([fauxAssistantMessage("a".repeat(300)),fauxAssistantMessage("continued")]);
  const models=createModels();models.setProvider(faux.provider);
  let effects=0;
  const tools=withTool ? [{name:"effect",label:"effect",description:"test",parameters:Type.Object({}),replay:"never" as const,execute:async()=>{effects++;return {content:[{type:"text" as const,text:"saved"}],details:{}};}}] : [];
  const {harness}=await AgentHarness.create({session:stored,models,model:faux.getModel(),systemPrompt:"test",tools},TODO_CONTEXT);
  installStopHooks(harness);
  const lane=await harness.lane("main",{createAt:null},TODO_CONTEXT);
  let context:Context=TODO_CONTEXT;
  const session={id:stored.metadata.id,userId:"owner",agentId:"main",runtime:{
    harness,tools:[],readRecentMessages:async()=>[],
    prompt:async(q:string,c:Context)=>{context=c;return lane.prompt(q,undefined,c);},
    abort:()=>cancelLaneOperation(lane,context),appendCustomEntry:(type:string,data:any)=>lane.appendCustomEntry(type,data,TODO_CONTEXT),
  }};
  const manager=Object.create(AgentSessionManager.prototype) as AgentSessionManager;
  Object.assign(manager,{acquireForRun:async()=>({session,release:manager.reserve(session as never)}),checkpoint:async()=>{},restored:()=>false,running:new Set(),idleWaiters:new Map(),assertOwnership:async()=>{},resolveAgentId:async()=>"main",acquire:async()=>session,
    history:async()=>({agentId:"main",entries:await lane.findEntries({order:"newestFirst"},TODO_CONTEXT),hasMore:false,nextCursor:null}),toolsForHistory:()=>[],
  });
  const registry={get:()=>({id:"main"})};
  const streams=createAgentRoutes(registry as never,manager,timeoutMs),stops=createSessionRoutes(registry as never,manager,stopTimeoutMs);
  const principal={userId:"owner",source:"user"} as const;
  const chat=(message:string)=>runWithRequestPrincipal(principal,()=>streams.request("/stream",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:session.id,message})}));
  const stop=()=>runWithRequestPrincipal(principal,()=>stops.request(`/sessions/${session.id}/stop`,{method:"POST"}));
  return {session,lane,manager,chat,stop,stops,streams,principal,faux,effects:()=>effects,async close(){await harness.close(TODO_CONTEXT);await repo.close(TODO_CONTEXT);}};
}

test("real Pi: stop during a blocked start notification never starts a prompt",async()=>{
  const f=await fixture();let reached!:()=>void,unblock!:()=>void;
  const ready=new Promise<void>(r=>{reached=r;}),held=new Promise<void>(r=>{unblock=r;});
  const release=f.manager.reserve(f.session as never);
  const run=runAgent(f.session as never,"first",new AbortController().signal,{},async()=>{},async()=>{reached();await held;});
  const failed=assert.rejects(run,{name:"AbortError"}).finally(release);
  try {await ready;assert.equal(await deadline(stopAgentRun(f.session.id)),true);await failed;
    assert.equal((await f.lane.inspectExecution(TODO_CONTEXT)).current,null);
    assert.equal((await f.lane.findEntries({type:"message"},TODO_CONTEXT)).length,0);
  } finally {unblock();await failed;await f.close();}
});

test("real Pi + HTTP: paused delta reader cannot block stop, history or the next turn",async()=>{
  const f=await fixture();const response=await f.chat("first");const reader=response.body!.getReader();
  try {
    const decoder=new TextDecoder();let delta=false;
    while(!delta){const chunk=await deadline(reader.read());assert.equal(chunk.done,false);delta=decoder.decode(chunk.value).includes("event: delta");}
    // Allow the producer's next write to block; keep the reader paused throughout stop.
    await new Promise(r=>setTimeout(r,60));
    assert.equal((await deadline(Promise.resolve(f.stop()))).status,200);
    assert.equal((await f.lane.inspectExecution(TODO_CONTEXT)).current,null);
    const history=await runWithRequestPrincipal(f.principal,()=>f.stops.request(`/sessions/${f.session.id}/history`));
    const messages=(await history.json() as any).result.messages;
    assert.equal(messages.at(-1).state,"stopped");assert.ok(messages.at(-1).blocks.some((b:any)=>b.type==="text"&&b.content.length));
    const next=await f.chat("next");const text=await deadline(next.text(),1500);
    assert.equal(text.split("\n").filter(l=>l.startsWith("data: {")&&l.includes('"text"')).map(l=>JSON.parse(l.slice(6)).text).join(""),"continued");assert.match(text,/event: done/);
    assert.equal((await f.stop()).status,200);
  }finally {await reader.cancel();await deadline(stopAgentRun(f.session.id));await f.close();}
});


test("real Pi + HTTP: run timeout persists stopped and the same session continues",async()=>{
  const f=await fixture(100);
  try {
    const first=await f.chat("first");const body=await deadline(first.text());
    assert.match(body,/event: stopped/);assert.doesNotMatch(body,/event: done/);
    assert.equal((await f.lane.inspectExecution(TODO_CONTEXT)).current,null);
    const history=await runWithRequestPrincipal(f.principal,()=>f.stops.request(`/sessions/${f.session.id}/history`));
    assert.equal((await history.json() as any).result.messages.at(-1).state,"stopped");
    const next=await f.chat("next");assert.match(await deadline(next.text()),/event: done/);
  }finally{await f.close();}
});

test("stop deadline includes ownership and cannot cancel a turn after expiry",async()=>{
  const f=await fixture(undefined,20);let finish!:()=>void;
  let owned=false;
  Object.assign(f.manager,{assertOwnership:()=>new Promise<void>(r=>{finish=()=>{owned=true;r();};})});
  try {
    const response=await deadline(Promise.resolve(f.stop()));assert.equal(response.status,503);
    const next=await f.chat("first");const reader=next.body!.getReader();await reader.read();
    finish();await new Promise(r=>setTimeout(r,40));assert.equal(owned,true);
    assert.notEqual((await f.lane.inspectExecution(TODO_CONTEXT)).current,null);
    await reader.cancel();await deadline(stopAgentRun(f.session.id));
  }finally{await f.close();}
});

test("real HTTP socket: stop returns, partial history survives and next turn completes",async()=>{
  const f=await fixture();
  const app=new Hono();app.use("*",(_c,next)=>runWithRequestPrincipal(f.principal,next));
  app.route("/",f.streams);app.route("/",f.stops);
  const server=serve({fetch:app.fetch,port:0});
  await new Promise<void>(resolve=>server.listening?resolve():server.once("listening",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const base=`http://127.0.0.1:${address.port}`;
  const chat=(message:string)=>fetch(`${base}/stream`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:f.session.id,message})});
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try {
    const response=await chat("first");reader=response.body!.getReader();
    let delta=false;while(!delta){const chunk=await deadline(reader.read());delta=new TextDecoder().decode(chunk.value).includes("event: delta");}
    const stops=await deadline(Promise.all([1,2].map(()=>fetch(`${base}/sessions/${f.session.id}/stop`,{method:"POST"}))));
    assert.ok(stops.every(r=>r.status===200));
    const history=await fetch(`${base}/sessions/${f.session.id}/history`);
    assert.equal((await history.json() as any).result.messages.at(-1).state,"stopped");
    const next=await chat("next");assert.match(await deadline(next.text()),/event: done/);
  }finally{await reader?.cancel();(server as Server).closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.close();}
});

test("transport detaches a stalled reader while the turn completes in memory",async()=>{
  const f=await fixture();const response=await f.chat("first");const reader=response.body!.getReader();
  try {
    const first=await reader.read();assert.equal(first.done,false);
    await deadline(f.manager.waitUntilIdle(f.session.id),6500);
    assert.equal((await f.lane.inspectExecution(TODO_CONTEXT)).current,null);
    const history=await runWithRequestPrincipal(f.principal,()=>f.stops.request(`/sessions/${f.session.id}/history`));
    assert.equal((await history.json() as any).result.messages.at(-1).state,undefined);
    const next=await f.chat("next");assert.match(await deadline(next.text()),/event: done/);
  }finally{await reader.cancel();await f.close();}
});


for(const phase of ["turn_start","message_start","delta","message_end","tool_start","tool_end"] as const) {
  test(`real Pi: blocked ${phase} delivery is cancellable and preserves effects`,async()=>{
    const toolPhase=phase.startsWith("tool_");const f=await fixture(undefined,undefined,toolPhase);
    f.faux.setResponses([toolPhase?fauxAssistantMessage(fauxToolCall("effect",{})):fauxAssistantMessage("first"),fauxAssistantMessage("continued")]);
    let reached!:()=>void,unblock!:()=>void;
    const ready=new Promise<void>(r=>{reached=r;}),held=new Promise<void>(r=>{unblock=r;});
    const release=f.manager.reserve(f.session as never);
    const run=runAgent(f.session as never,"first",new AbortController().signal,{},async event=>{if(event.type===phase){reached();await held;}});
    const cancelled=assert.rejects(run,{name:"AbortError"}).finally(release);
    try {
      await deadline(ready);const stopping=stopAgentRun(f.session.id);unblock();assert.equal(await deadline(stopping),true);await cancelled;
      assert.equal((await f.lane.inspectExecution(TODO_CONTEXT)).current,null);
      const history=await runWithRequestPrincipal(f.principal,()=>f.stops.request(`/sessions/${f.session.id}/history`));
      assert.equal((await history.json() as any).result.messages.at(-1).state,"stopped");
      if(phase==="tool_end") {
        assert.equal(f.effects(),1);
        assert.ok((await f.lane.findEntries({type:"message"},TODO_CONTEXT)).some(entry=>entry.type==="message"&&entry.message.role==="toolResult"&&!entry.message.isError));
      }
      const next=await f.chat("next");assert.match(await deadline(next.text()),/event: done/);
      if(phase==="tool_end")assert.equal(f.effects(),1);
    }finally {unblock();await cancelled;await f.close();}
  });
}

test("terminal output is bounded after releasing the session",async()=>{
  const f=await fixture();f.faux.setResponses([fauxAssistantMessage("first"),fauxAssistantMessage("continued")]);
  const response=await f.chat("first");const reader=response.body!.getReader();
  try {
    let ended=false;while(!ended){const chunk=await deadline(reader.read());ended=new TextDecoder().decode(chunk.value).includes("event: message_end");}
    await deadline(f.manager.waitUntilIdle(f.session.id));
    assert.equal((await deadline(Promise.resolve(f.stop()))).status,200);
    const next=await f.chat("next");assert.match(await deadline(next.text()),/event: done/);
  }finally{await reader.cancel();await f.close();}
});
