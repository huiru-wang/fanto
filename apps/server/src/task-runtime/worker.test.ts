import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "../domain/tasks/index.js";
import { renderTaskBrief } from "./worker.js";

test("TaskWorker receives a pure user Task Brief without execution internals", () => {
  const task = {
    taskId: "internal-task-id",
    userId: "internal-user-id",
    agentId: "task-worker",
    goal: {
      objective: "整理最近一周值得推进的想法",
      context: "关注与当前项目相关且反复出现的想法",
      constraints: ["不要猜测"],
      successCriteria: ["结果可独立阅读"],
    },
    trigger: { type: "immediate" },
    output: { format: "html" },
    references: { recordIds: ["record-1"] },
    extData: { timeZone: "Asia/Shanghai" },
  } as unknown as Task;

  const prompt = renderTaskBrief(task);
  assert.match(prompt, /# Task Brief/);
  assert.match(prompt, /## Objective\n整理最近一周值得推进的想法/);
  assert.match(prompt, /## Context\n关注与当前项目相关且反复出现的想法/);
  assert.match(prompt, /## Constraints\n- 不要猜测/);
  assert.match(prompt, /## Success Criteria\n- 结果可独立阅读/);
  assert.doesNotMatch(prompt, /record-1|Result format|result\.html|deliver_task_result|Asia\/Shanghai/);
  assert.doesNotMatch(prompt, /internal-task-id|internal-user-id|task-worker/);
});

test("TaskWorker retries a failed attempt with a new Worker Session before failing the TaskRun", async () => {
  let attempts = 0;
  let sessionCount = 0;
  let rebinds = 0;
  let failed = 0;
  let currentRun: any = {
    runId: "run-1",
    taskId: "task-1",
    userId: "user-1",
    status: "running",
    scheduledAt: "2026-09-30T00:00:00.000Z",
    workerSessionId: "session-1",
    result: null,
    resultMediaId: null,
    plan: { summary: "plan", steps: [{ id: "one", title: "do" }], createdAt: "x", updatedAt: "x", version: 1 },
  };
  const tasks = {
    startDueRun: async (_task: any, sessionId: string) => ({ ...currentRun, workerSessionId: sessionId }),
    rebindRunWorkerSession: async (_userId: string, _taskId: string, _runId: string, sessionId: string) => {
      rebinds += 1;
      currentRun = { ...currentRun, workerSessionId: sessionId };
      return currentRun;
    },
    findRun: async () => currentRun,
    failRun: async () => { failed += 1; },
  } as any;
  const registry = {
    get: () => ({ id: "task-worker", task: { enabled: true, defaultTimeoutSeconds: 10, maxTimeoutSeconds: 10, maxAttempts: 2 } }),
  } as any;
  const sessions = {
    create: async () => ({ id: `session-${++sessionCount}` }),
    reserve: () => () => {},
    release: async () => {},
  } as any;
  const runner = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary model failure");
    currentRun = { ...currentRun, status: "completed", resultMediaId: "media-1", result: { summary: "done", artifacts: [] } };
    return "";
  };
  const worker = new (await import("./worker.js")).TaskWorker(tasks, registry, sessions, runner as any);
  const task = {
    taskId: "task-1",
    userId: "user-1",
    agentId: "task-worker",
    timeoutSeconds: 10,
    nextRunAt: "2026-09-30T00:00:00.000Z",
    trigger: { type: "immediate" },
    goal: { objective: "do it" },
    output: { format: "html" },
    references: { recordIds: [] },
    extData: {},
  } as any;

  await worker.execute(task);
  assert.equal(attempts, 2);
  assert.equal(rebinds, 1);
  assert.equal(failed, 0);
});
