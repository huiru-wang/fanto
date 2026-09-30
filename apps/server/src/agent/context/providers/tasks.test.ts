import assert from "node:assert/strict";
import test from "node:test";
import { TaskProvider } from "./tasks.js";
import { createRunContext } from "../run-context.js";

test("TaskProvider exposes current task IDs to the main Agent prompt", async () => {
  const provider = new TaskProvider({
    listTasks: async () => ({
      data: [{ taskId: "task-1", status: "active", agentId: "task-worker", title: "制作贺卡", goal: { objective: "生成 HTML 贺卡" }, references: { recordIds: ["record-1"] } }],
    }),
  } as never);
  const context = createRunContext({
    runId: "run-1",
    userId: "user-1",
    sessionId: "session-1",
    query: "hello",
    recentMessages: [],
    slots: {},
  });

  const result = await provider.build(context);

  assert.equal(result.slot, "current_tasks");
  assert.match(result.content, /taskId: task-1/);
  assert.match(result.content, /制作贺卡/);
  assert.match(result.content, /referenceRecordIds: record-1/);
});
