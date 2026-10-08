import assert from "node:assert/strict";
import test from "node:test";
import { CreativeRunner } from "./runner.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const config = {workers:1, proposalTimeoutMs:2000, creatorTimeoutMs:2000};

test("creative task submission queues without waiting or dropping jobs at capacity", async () => {
  const runner = new CreativeRunner({} as never, {} as never, config);
  const gate = deferred(), started: string[] = [];
  (runner as unknown as {analyzeRecord: (user: string, id: string) => Promise<void>}).analyzeRecord = async (_user, id) => {
    started.push(id);
    if (id === "a") await gate.promise;
  };
  runner.submitProposal("user", "a", 1);
  runner.submitProposal("user", "b", 1);
  runner.submitProposal("user", "b", 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["a"]);
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b"]);
  await runner.stop();
});

test("queued creator submission returns before execution completes and deduplicates while pending", async () => {
  const runner = new CreativeRunner({} as never, {} as never, config);
  const gate = deferred(), started: string[] = [];
  (runner as unknown as {ensureSession: (userId: string, projectId: string) => Promise<string>}).ensureSession = async () => "session";
  (runner as unknown as {dispatch: (user: string, project: string, proposal: string) => Promise<void>}).dispatch = async (_u, _p, proposal) => {
    started.push(proposal);
    if (proposal === "first") await gate.promise;
  };
  assert.equal(await runner.onAccepted("user", "project", "first"), "session");
  assert.equal(await runner.onAccepted("user", "project", "second"), "session");
  assert.equal(await runner.onAccepted("user", "project", "second"), "session");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["first"]);
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["first", "second"]);
  await runner.stop();
});
