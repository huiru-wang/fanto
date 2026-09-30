import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "../domain/tasks/index.js";
import { TaskWorkerPool } from "./worker-pool.js";

const task = (id: string) => ({ taskId: id } as Task);

test("TaskWorkerPool exposes capacity without queueing overflow work", async () => {
  let finish!: () => void;
  const first = new Promise<void>(resolve => { finish = resolve; });
  const executed: string[] = [];
  const pool = new TaskWorkerPool(1, {
    execute: async candidate => {
      executed.push(candidate.taskId);
      await first;
    },
  });

  const execution = pool.trySubmit(task("task-a"));
  assert.ok(execution);
  assert.equal(pool.runningCount, 1);
  assert.equal(pool.available, 0);
  assert.equal(pool.trySubmit(task("task-b")), null);
  assert.deepEqual(executed, ["task-a"]);

  finish();
  await execution;
  assert.equal(pool.runningCount, 0);
  assert.equal(pool.available, 1);
});
