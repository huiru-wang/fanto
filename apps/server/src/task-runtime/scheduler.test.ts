import assert from "node:assert/strict";
import test from "node:test";
import type { Task, TaskService } from "../domain/tasks/index.js";
import { TaskScheduler } from "./scheduler.js";
import type { TaskWorkerPool } from "./worker-pool.js";

const task = { taskId: "task-1", extData: {} } as Task;

test("Scheduler dispatches no more due tasks than the worker pool can accept", async () => {
  const calls: string[] = [];
  const tasks = {
    dueTasks: async (_now: Date, limit: number) => {
      calls.push(`due:${limit}`);
      return [task];
    },
  } as unknown as TaskService;
  const workers = {
    available: 1,
    trySubmit: (candidate: Task) => {
      calls.push(`submit:${candidate.taskId}`);
      return Promise.resolve();
    },
  } as unknown as TaskWorkerPool;

  await new TaskScheduler(tasks, workers, 300_000).tick(new Date("2026-09-29T00:00:00.000Z"));
  assert.deepEqual(calls, ["due:1", "submit:task-1"]);
});

test("Scheduler does not scan tasks while all workers are busy", async () => {
  let scanned = false;
  const tasks = {
    dueTasks: async () => { scanned = true; return [task]; },
  } as unknown as TaskService;
  const workers = { available: 0 } as TaskWorkerPool;

  await new TaskScheduler(tasks, workers, 300_000).tick();
  assert.equal(scanned, false);
});

test("Scheduler tick is single-flight", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let scanCount = 0;
  const tasks = {
    dueTasks: async () => {
      scanCount += 1;
      await blocked;
      return [];
    },
  } as unknown as TaskService;
  const workers = { available: 1 } as TaskWorkerPool;
  const scheduler = new TaskScheduler(tasks, workers, 300_000);

  const first = scheduler.tick();
  const second = scheduler.tick();
  await second;
  assert.equal(scanCount, 1);
  release();
  await first;
});
