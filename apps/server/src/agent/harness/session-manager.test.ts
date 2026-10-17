import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentSessionManager, SessionOwnershipError, SessionBusyError } from "./session-manager.js";

test("Session agent identity cannot change for cached Sessions", async () => {
  const id = randomUUID();
  const manager = Object.create(AgentSessionManager.prototype) as any;
  manager.sessions = new Map([[id, {id,agentId:"creator-agent",userId:"owner",revision:"old"}]]);
  manager.running = new Set();
  await assert.rejects(manager.acquire({id:"main",revision:"new"},id,"owner"),SessionOwnershipError);
  await assert.rejects(manager.acquire({id:"creator-agent",revision:"new"},id,"intruder"),SessionOwnershipError);
  assert.equal(await manager.resolveAgentId(id,"owner"),"creator-agent");
  assert.equal(manager.sessions.get(id).agentId,"creator-agent");
});

test("Persisted Session mismatch never rebuilds Harness or rewrites identity", async () => {
  const id = randomUUID(); let rebuilt = false, rewritten = false;
  const manager = Object.create(AgentSessionManager.prototype) as any;
  manager.sessions = new Map();
  manager.running = new Set();
  manager.repository = { closedHandle:()=>{}, closeReadHandle:async()=>{}, getById: async () => ({id}), open: async () => ({close:async()=>{}}) };
  manager.readOwner = async () => ({agentId:"proposal-agent",userId:"owner",revision:"r1"});
  manager.createManaged = async () => {rebuilt=true;return {};};
  manager.writeBinding = async () => {rewritten=true;};
  await assert.rejects(manager.acquire({id:"creator-agent",revision:"r2"},id,"owner"),SessionOwnershipError);
  assert.equal(rebuilt,false);
  assert.equal(rewritten,false);
  assert.equal(await manager.resolveAgentId(id,"owner"),"proposal-agent");
  await assert.rejects(manager.resolveAgentId(id,"other"),SessionOwnershipError);
});


test("Same Session agent identity allows revision upgrades", async () => {
  const id = randomUUID(); let savedRevision: string | undefined;
  const manager = Object.create(AgentSessionManager.prototype) as any;
  manager.sessions = new Map();
  manager.running = new Set();
  manager.repository = {getById:async()=>({id}),open:async()=>({close:async()=>{}})};
  manager.readOwner = async () => ({agentId:"creator-agent",userId:"owner",revision:"old"});
  manager.createManaged = async (_session:unknown,_id:string,userId:string,definition:{id:string;revision:string}) => ({id,agentId:definition.id,userId,revision:definition.revision});
  manager.writeBinding = async (_session:unknown,definition:{revision:string}) => {savedRevision=definition.revision;};
  const session = await manager.acquire({id:"creator-agent",revision:"new"},id,"owner");
  assert.equal(session.agentId,"creator-agent");
  assert.equal(session.revision,"new");
  assert.equal(savedRevision,"new");
});


test("a Session being closed by its reserved owner cannot reopen until released", async () => {
  const id=randomUUID();const manager=Object.create(AgentSessionManager.prototype) as any;
  manager.sessions=new Map();manager.running=new Set();manager.idleWaiters=new Map();
  manager.repository={checkpoint:async()=>{},closedHandle:()=>{}};
  manager.checkpoint=async()=>{};
  let close!:()=>void;
  manager.sessions.set(id,{runtime:{close:()=>new Promise<void>(resolve=>{close=resolve;})}});
  const release=manager.reserve({id});
  assert.equal(manager.isRunning(id), true);
  const closing=manager.release(id,true);
  await assert.rejects(manager.acquire({id:"main"},id,"owner"),SessionBusyError);
  let idle=false;const wait=manager.waitUntilIdle(id).then(()=>{idle=true;});
  await new Promise(resolve=>setImmediate(resolve));
  close();await closing;assert.equal(idle,false);
  assert.equal(manager.isRunning(id), true);
  release();await wait;assert.equal(idle,true);
  assert.equal(manager.isRunning(id), false);
});

test("releasing an old reservation twice cannot release the next turn",async()=>{
  const manager=Object.create(AgentSessionManager.prototype) as any;
  manager.running=new Set();manager.idleWaiters=new Map();
  const session={id:randomUUID()};const oldRelease=manager.reserve(session);
  oldRelease();const nextRelease=manager.reserve(session);oldRelease();
  assert.throws(()=>manager.reserve(session),SessionBusyError);
  nextRelease();assert.doesNotThrow(()=>manager.reserve(session)());
});

test("stop waiter sees durable finalization failure without retaining the reservation",async()=>{
  const manager=Object.create(AgentSessionManager.prototype) as any;
  manager.running=new Set();manager.idleWaiters=new Map();
  const session={id:randomUUID()};const release=manager.reserve(session);
  const waiter=assert.rejects(manager.waitUntilIdle(session.id),/persistence failed/);
  release(Error("persistence failed"));await waiter;
  assert.doesNotThrow(()=>manager.reserve(session)());
});
