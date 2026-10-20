import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentSessionManager, SessionOwnershipError, SessionBusyError } from "./session-manager.js";

test("Session agent identity cannot change for cached Sessions", async () => {
  const id = randomUUID();
  const manager = Object.create(AgentSessionManager.prototype) as any;
  manager.sessions = new Map([[id, {id,agentId:"main",userId:"owner",revision:"old"}]]);
  manager.running = new Set();
  await assert.rejects(manager.acquire({id:"other-agent",revision:"new"},id,"owner"),SessionOwnershipError);
  await assert.rejects(manager.acquire({id:"main",revision:"new"},id,"intruder"),SessionOwnershipError);
  assert.equal(await manager.resolveAgentId(id,"owner"),"main");
  assert.equal(manager.sessions.get(id).agentId,"main");
});

test("Persisted Session mismatch never rebuilds Harness or rewrites identity", async () => {
  const id = randomUUID(); let rebuilt = false;
  const manager = Object.create(AgentSessionManager.prototype) as any;
  manager.sessions = new Map();
  manager.running = new Set();
  manager.repository = { checkpoints: { getSession:async()=>({id,userId:"owner",agentId:"other-agent"}) }, closedHandle:()=>{}, closeReadHandle:async()=>{}, getById: async () => ({id}), open: async () => ({close:async()=>{}}) };
  manager.createManaged = async () => {rebuilt=true;return {};};
  await assert.rejects(manager.acquire({id:"main",revision:"r2"},id,"owner"),SessionOwnershipError);
  assert.equal(rebuilt,false);
  assert.equal(await manager.resolveAgentId(id,"owner"),"other-agent");
  await assert.rejects(manager.resolveAgentId(id,"other"),SessionOwnershipError);
});


test("Cold-open Session takes the current Agent revision without old owner entry", async () => {
  const id = randomUUID(); let builtRevision: string | undefined;
  const manager = Object.create(AgentSessionManager.prototype) as any;
  manager.sessions = new Map();
  manager.running = new Set();
  manager.repository = { checkpoints: { getSession:async()=>({id,userId:"owner",agentId:"main"}) }, getById:async()=>({id}),open:async()=>({close:async()=>{}})};
  manager.createManaged = async (_session:unknown,_id:string,userId:string,definition:{id:string;revision:string}) => {
    builtRevision=definition.revision;
    return {id,agentId:definition.id,userId,revision:definition.revision};
  };
  const session = await manager.acquire({id:"main",revision:"new"},id,"owner");
  assert.equal(session.agentId,"main");
  assert.equal(session.revision,"new");
  assert.equal(builtRevision,"new");
});


test("a Session being closed by its reserved owner cannot reopen until released", async () => {
  const id=randomUUID();const manager=Object.create(AgentSessionManager.prototype) as any;
  manager.sessions=new Map();manager.running=new Set();manager.idleWaiters=new Map();
  manager.repository={checkpoint:async()=>{},closedHandle:()=>{},evict:async()=>{}};
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
