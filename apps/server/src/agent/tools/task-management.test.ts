import assert from "node:assert/strict";
import test from "node:test";
import { createCreateTaskTool, createTaskSchema, sanitizeCreateTaskDetails } from "./task-management.js";

const catalog = [
  { id: "task-worker", description: "处理文件交付任务" },
] as const;

test("create_task schema limits agentId to the Registry task-agent catalog", () => {
  const schema = createTaskSchema(catalog) as any;
  const agentId = schema.properties.agentId;

  assert.deepEqual(
    agentId.anyOf.map((item: any) => item.const),
    ["task-worker"],
  );
  assert.match(agentId.description, /task-worker: 处理文件交付任务/);
});

test("create_task description tells main Agent what each sub-agent is for", () => {
  const tool = createCreateTaskTool(
    { createTask: async () => ({ taskId: "t1", nextRunAt: "2026-09-30T00:00:00.000Z", status: "active" as const }) } as any,
    catalog,
  );

  assert.match(tool.description, /可用后台 Agent/);
  assert.match(tool.description, /task-worker: 处理文件交付任务/);
});

test("create_task schema follows a changed catalog without code changes", () => {
  const schema = createTaskSchema([
    { id: "data-analysis", description: "分析结构化数据" },
  ]) as any;

  assert.deepEqual(
    schema.properties.agentId.anyOf.map((item: any) => item.const),
    ["data-analysis"],
  );
});

test("create_task cannot be created without an available task Agent", () => {
  assert.throws(() => createTaskSchema([]), /at least one task-enabled sub-agent/);
});


test("create_task presentation sanitizer exposes only the stable task card payload", () => {
  const result = sanitizeCreateTaskDetails({
    kind: "task_created",
    task: {
      taskId: "task-1",
      title: "旅行回顾",
      status: "active",
      trigger: { type: "immediate" },
      nextRunAt: "2026-09-30T00:00:00.000Z",
      output: { format: "html", internal: "hidden" },
      userId: "must-not-leak",
    },
    traceId: "must-not-leak",
  });

  assert.deepEqual(result, {
    kind: "task_created",
    task: {
      taskId: "task-1",
      title: "旅行回顾",
      status: "active",
      trigger: { type: "immediate" },
      nextRunAt: "2026-09-30T00:00:00.000Z",
      output: { format: "html" },
    },
  });
});
