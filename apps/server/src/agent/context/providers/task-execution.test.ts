import assert from "node:assert/strict";
import test from "node:test";
import { createRunContext } from "../run-context.js";
import { TaskExecutionContextProvider } from "./task-execution.js";

test("TaskExecutionContextProvider keeps technical execution data in the system prompt slot", async () => {
  const provider = new TaskExecutionContextProvider({
    getTask: async () => ({
      task: { output: { format: "html" }, references: { recordIds: ["record-1"] } },
      runs: [{ runId: "run-1", scheduledAt: "2026-09-30T01:00:00.000Z", plan: null }],
    }),
  } as any);
  const context = createRunContext({
    runId: "agent-run", userId: "user-1", query: "brief", slots: {}, sessionId: "worker-session", recentMessages: [],
    task: { taskId: "task-1", taskRunId: "run-1" }, timeZone: "Asia/Shanghai",
  });
  const result = await provider.build(context);
  assert.match(result.content, /Output format: html/);
  assert.match(result.content, /Primary result file: result\.html/);
  assert.match(result.content, /Reference Record IDs:\n- record-1/);
  assert.match(result.content, /Existing saved plan: none/);
});
