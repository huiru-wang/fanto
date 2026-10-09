import test from "node:test";
import assert from "node:assert/strict";
import type { TaskService, Task } from "./index.js";
import { TaskScheduler } from "./scheduler.js";
import { AgentExecutionQueue } from "../../event/agent-execution-queue.js";

test("scheduler creates queued Run before publishing its id", async()=>{
  const queue=new AgentExecutionQueue();
  let got:any;
  queue.on(async msg=>{got=msg;});
  const due=[{taskId:"a",userId:"u",nextRunAt:new Date().toISOString()} as Task];
  const service={
    dueTasks:async()=>due,
    startDueRun:async()=>({runId:"run",status:"queued"})
  } as unknown as TaskService;
  const scheduler=new TaskScheduler(service,queue,100000);
  await scheduler.tick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(got,{type:"task",userId:"u",taskId:"a",taskRunId:"run"});
});
test("scheduler tick is single-flight",async()=>{
  let release!:()=>void;
  let scans=0;
  const blocked=new Promise<void>(r=>{release=r;});
  const service={dueTasks:async()=>{scans++;await blocked;return[];}} as unknown as TaskService;
  const scheduler=new TaskScheduler(service,new AgentExecutionQueue(),300000);
  const a=scheduler.tick();await scheduler.tick();assert.equal(scans,1);release();await a;
});

test("immediate task wake is not lost while a scheduler tick is running",async()=>{
  let release!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  let scans=0;
  const service={dueTasks:async()=>{scans++;if(scans===1)await blocked;return[];}} as unknown as TaskService;
  const scheduler=new TaskScheduler(service,new AgentExecutionQueue(),300000);
  const first=scheduler.tick();
  scheduler.wake();
  release();
  await first;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scans,2);
});
