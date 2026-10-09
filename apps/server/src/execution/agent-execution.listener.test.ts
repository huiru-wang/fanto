import test from "node:test";
import assert from "node:assert/strict";
import { AgentExecutionQueue } from "../event/agent-execution-queue.js";
import { AgentExecutionListener } from "./agent-execution.listener.js";

test("background Agent concurrency shared across types, FIFO and non-blocking publish",async()=>{
  const queue=new AgentExecutionQueue();
  const started:string[]=[];
  let release!:()=>void;
  const block=new Promise<void>(r=>{release=r;});
  const proposal={execute:async (_u:string,id:string)=>{started.push(id);if(id==="a")await block;}};
  const creator={execute:async(_u:string,_id:string,proposalId:string)=>{started.push(proposalId);}};
  const handler=new AgentExecutionListener(queue,1,proposal as never,creator as never,{} as never);
  queue.publish({type:"proposal",userId:"u",recordId:"a",version:1});
  queue.publish({type:"creator",userId:"u",projectId:"p",proposalId:"b"});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(started,["a"]);
  release();await handler.stop();
  assert.deepEqual(started,["a"]); // stop discards pending work; no recovery
});
test("session event subscribers isolate sessions",async()=>{
  const {SessionEventBus}=await import("../event/session-event-bus.js");
  const bus=new SessionEventBus(),got:string[]=[];
  const off=bus.subscribe("a",event=>got.push(event.type));
  bus.publish("b",{type:"done"});bus.publish("a",{type:"done"});off();
  bus.publish("a",{type:"error"});assert.deepEqual(got,["done"]);
});

test("listener drains pending messages as capacity becomes available",async()=>{
  const queue=new AgentExecutionQueue();
  const calls:string[]=[];
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const proposal={execute:async(_user:string,id:string)=>{calls.push(id);if(id==="first")await gate;}};
  const listener=new AgentExecutionListener(queue,1,proposal as never,undefined,{} as never);
  queue.publish({type:"proposal",userId:"u",recordId:"first",version:1});
  queue.publish({type:"proposal",userId:"u",recordId:"second",version:1});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,["first"]);
  release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,["first","second"]);
  await listener.stop();
});
