import assert from "node:assert/strict";
import test from "node:test";
import { createRunContext } from "../context/run-context.js";
import { createCreateTaskTool, createTaskSchema, sanitizeCreateTaskDetails } from "./task-management.js";

const catalog = [{ id: "task-worker", description: "处理文件交付任务" }] as const;

test("create_task schema exposes user intent fields only and requires output format", () => {
  const schema = createTaskSchema() as any;
  assert.equal(schema.required.includes("output"), true);
  assert.equal("agentId" in schema.properties, false);
  assert.equal("timeoutSeconds" in schema.properties, false);
  assert.equal("result" in schema.properties, false);
  assert.ok(schema.properties.references);
  assert.deepEqual(Object.keys(schema.properties.references.properties), ["recordIds"]);
});

test("create_task uses the single configured task worker without exposing routing to the model", () => {
  const tool = createCreateTaskTool({ createTask: async () => ({}) } as any, catalog);
  assert.match(tool.description, /用户需求说明/);
  assert.match(tool.description, /output\.format 必填/);
  assert.doesNotMatch(JSON.stringify(tool.parameters), /agentId|mediaIds|timeoutSeconds/);
});


test("create_task execution preserves the requested output and hides Worker routing from the model contract", async () => {
  let received: any;
  const tool = createCreateTaskTool({
    createTask: async (_context: any, input: any) => {
      received = input;
      return {
        taskId: "task-1",
        title: input.title,
        status: "active",
        trigger: input.trigger,
        nextRunAt: "2026-09-30T00:00:00.000Z",
        output: input.output,
      };
    },
  } as any, catalog);
  const context = createRunContext({
    runId: "run-1", userId: "user-1", sessionId: "session-1", query: "做 HTML 卡片", slots: {}, recentMessages: [], timeZone: "Asia/Shanghai",
  });
  await (tool.execute as any)(
    "call-1",
    {
      title: "奉化旅行卡片",
      goal: { objective: "制作奉化自驾游图文卡片", context: "给妻子看的纪念卡片" },
      trigger: { type: "immediate" },
      output: { format: "html" },
      references: { recordIds: ["record-1"] },
    },
    () => {}, {}, {}, context,
  );
  assert.deepEqual(received, {
    title: "奉化旅行卡片",
    agentId: "task-worker",
    goal: { objective: "制作奉化自驾游图文卡片", context: "给妻子看的纪念卡片" },
    trigger: { type: "immediate" },
    output: { format: "html" },
    references: { recordIds: ["record-1"] },
  });
});
test("create_task rejects zero or multiple task workers until routing becomes a product concern", () => {
  assert.throws(() => createCreateTaskTool({} as any, []), /one task-enabled sub-agent/);
  assert.throws(() => createCreateTaskTool({} as any, [
    { id: "worker-a", description: "a" },
    { id: "worker-b", description: "b" },
  ]), /exactly one task-enabled sub-agent/);
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
