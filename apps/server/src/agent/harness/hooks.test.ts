import assert from "node:assert/strict";
import test from "node:test";
import { createRunContext } from "../context/run-context.js";
import { installHarnessHooks } from "./hooks.js";

function harnessWithHandlers() {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const harness = {
    hooks: {
      on(name: string, handler: (...args: any[]) => unknown) { handlers.set(name, handler); },
    },
  } as any;
  installHarnessHooks(harness, {
    workspace: process.cwd(),
    systemPrompt: { release: () => {} } as any,
    transformContext: async () => undefined,
  });
  return handlers;
}

test("successful task delivery and user input collection terminate the current turn", async () => {
  const handlers = harnessWithHandlers();
  const afterTool = handlers.get("after_tool")!;
  assert.deepEqual(await afterTool({ toolName: "deliver_task_result", isError: false }), { terminate: true });
  assert.deepEqual(await afterTool({ toolName: "collect_user_input", isError: false }), { terminate: true });
  assert.equal(await afterTool({ toolName: "deliver_task_result", isError: true }), undefined);
  assert.equal(await afterTool({ toolName: "write", isError: false }), undefined);
});

test("Task Worker cannot write, execute bash, or deliver before saving a plan", async () => {
  const handlers = harnessWithHandlers();
  const beforeTool = handlers.get("before_tool")!;
  const withoutPlan = createRunContext({
    runId: "run", userId: "user", query: "task", slots: {}, sessionId: "session", recentMessages: [],
    task: { taskId: "task", taskRunId: "task-run" },
  });
  const blocked = await beforeTool({ toolName: "write", args: { path: "result.html" } }, withoutPlan) as any;
  assert.match(blocked.block.reason, /task_plan_manage/);

  const withPlan = createRunContext({
    runId: "run", userId: "user", query: "task", slots: {}, sessionId: "session", recentMessages: [],
    task: { taskId: "task", taskRunId: "task-run" }, taskPlanReady: true,
  });
  assert.equal(await beforeTool({ toolName: "write", args: { path: "result.html" } }, withPlan), undefined);
});
