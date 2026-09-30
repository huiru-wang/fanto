import assert from "node:assert/strict";
import test from "node:test";
import { createRunContext } from "../context/run-context.js";
import { createTaskPlanManageTool } from "./task-plan-manage.js";

test("task_plan_manage persists through business service and unlocks execution in the current run", async () => {
  let received: any;
  const plan = {
    summary: "先整理素材，再完成卡片并检查最终效果。",
    steps: [{ id: "material", title: "整理旅行素材" }],
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    version: 1,
  };
  const tool = createTaskPlanManageTool({
    manageTaskPlan: async (context: any, input: any) => {
      received = { context, input };
      return plan;
    },
  } as any);
  const context = createRunContext({
    runId: "run", userId: "user-1", query: "task", slots: {}, sessionId: "worker-session", recentMessages: [],
    task: { taskId: "task-1", taskRunId: "run-1" },
  });

  const result = await (tool.execute as any)(
    "call-1",
    { action: "create", summary: plan.summary, steps: [{ id: "material", title: "整理旅行素材" }] },
    () => {},
    {},
    {},
    context,
  );
  assert.equal(createRunContext.read(context).taskPlanReady, true);
  assert.equal(received.context.sessionId, "worker-session");
  assert.deepEqual(received.context.task, { taskId: "task-1", taskRunId: "run-1" });
  assert.deepEqual(result.details, { plan });
});
