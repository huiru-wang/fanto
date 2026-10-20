import assert from "node:assert/strict";
import test from "node:test";
import { registerRecordPostprocessListener } from "./record-postprocess.listener.js";

function fixture(result: "completed" | "stale" | "failed") {
  let listener!: (task: { userId: string; recordId: string; version: number }) => Promise<void>;
  const events: string[] = [];
  const task = { userId: "owner", recordId: "record", version: 3 };
  const records = {
    claimPostprocess: async (input: typeof task) => { assert.equal(input.userId, "owner"); return { content: { blocks: [] } }; },
    completePostprocess: async (input: typeof task) => {
      assert.equal(input.version, 3);
      if (result === "failed") throw new Error("database unavailable");
      events.push("processed");
      return result === "stale" ? null : { id: task.recordId };
    },
    releasePostprocess: async () => { events.push("released"); },
  };
  registerRecordPostprocessListener(
    { on: (callback: typeof listener) => { listener = callback; } } as never,
    records as never, { findOwnedByIds: async () => [] } as never,
    {} as never, {} as never, {} as never,
    { publish: (input: typeof task) => { assert.deepEqual(input, task); events.push("embedding"); } } as never,
  );
  return { run: () => listener(task), events };
}

test("Record completion publishes only embedding after the processed write", async () => {
  const { run, events } = fixture("completed");
  await run();
  assert.deepEqual(events, ["processed", "embedding"]);
});

test("stale completion never publishes embedding and failure releases the claim", async () => {
  const stale = fixture("stale"); await stale.run();
  assert.deepEqual(stale.events, ["processed"]);
  const failed = fixture("failed");
  await assert.rejects(failed.run(), /database unavailable/);
  assert.deepEqual(failed.events, ["released"]);
});
