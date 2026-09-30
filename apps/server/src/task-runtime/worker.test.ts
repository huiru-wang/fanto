import assert from "node:assert/strict";
import test from "node:test";
import type { Task, TaskRun } from "../domain/tasks/index.js";
import { renderTaskGoal } from "./worker.js";

test("TaskWorker renders only goal and execution context for the sub-agent", () => {
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
    output: { format: "markdown" },
    sources: { recordIds: ["record-1"], mediaIds: ["media-1"] },
    extData: { timeZone: "Asia/Shanghai" },
  } as unknown as Task;
  const run = {
    runId: "internal-run-id",
    scheduledAt: "2026-09-29T10:00:00.000Z",
  } as TaskRun;

  const prompt = renderTaskGoal(task, run);
  assert.match(prompt, /## Objective\n整理最近一周值得推进的想法/);
  assert.match(prompt, /## Context\n关注与当前项目相关且反复出现的想法/);
  assert.match(prompt, /## Constraints\n- 不要猜测/);
  assert.match(prompt, /## Success Criteria\n- 结果可独立阅读/);
  assert.match(prompt, /## Source Record IDs\n- record-1/);
  assert.match(prompt, /## Source Media IDs\n- media-1/);
  assert.match(prompt, /call record_get for the relevant records/);
  assert.match(prompt, /Time zone: Asia\/Shanghai/);
  assert.match(prompt, /Result format: markdown/);
  assert.match(prompt, /Write the primary result as result\.md using a relative path/);
  assert.match(prompt, /call deliver_task_result/);
  assert.doesNotMatch(prompt, /internal-task-id|internal-run-id|internal-user-id|task-worker/);
});
