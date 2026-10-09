import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "../../domain/tasks/index.js";
import { renderTaskBrief } from "./task-brief.js";

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

