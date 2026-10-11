import assert from "node:assert/strict";
import test from "node:test";
import { waitForOutput } from "./run-output.js";

test("blocked delivery is detached on cancellation and late rejection is handled", async () => {
  const controller=new AbortController();let reject!: (error:Error)=>void;
  const pending=waitForOutput(()=>new Promise<void>((_,r)=>{reject=r;}),controller.signal);
  await Promise.resolve();controller.abort();
  assert.equal(await pending,"cancelled");reject(Error("disconnected"));
  await new Promise(resolve=>setImmediate(resolve));
});
test("delivery has a finite deadline and an already cancelled delivery never writes",async()=>{
  const controller=new AbortController();
  assert.equal(await waitForOutput(()=>new Promise(()=>{}),controller.signal,10),"timeout");
  controller.abort();
  assert.equal(await waitForOutput(()=>{throw Error("must not write");},controller.signal),"cancelled");
});
test("output failures propagate and successful output completes",async()=>{
  const signal=new AbortController().signal;
  await assert.rejects(waitForOutput(async()=>{throw Error("socket failure");},signal),/socket failure/);
  assert.equal(await waitForOutput(async()=>{},signal),"written");
});
