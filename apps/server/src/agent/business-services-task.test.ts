import assert from "node:assert/strict";
import test from "node:test";
import { createAgentBusinessServices } from "./business-services.js";

test("createTask derives identity and provenance from Run context", async () => {
  let received: any;
  const services = createAgentBusinessServices({
    records: {} as never,
    media: {} as never,
    preferences: {} as never,
    webSearch: { search: async () => ({ query: "q", summary: "s", sources: [] }) } as never,
    tasks: {
      delegate: async (context: any, input: any, policy: any) => {
        received = { context, input, policy };
        return { taskId: "task-1", nextRunAt: "2026-09-30T00:00:00.000Z", status: "active" as const };
      },
    } as never,
    resolveTaskAgent: agentId => agentId === "task-worker"
      ? { defaultTimeoutSeconds: 900, maxTimeoutSeconds: 3600 }
      : undefined,
  });

  const result = await services.createTask(
    {
      userId: "user-from-run",
      sessionId: "session-from-run",
      sourceMessageId: "message-from-run",
      traceId: "trace-from-run",
      timeZone: "Asia/Shanghai",
    },
    {
      title: "Research",
      agentId: "task-worker",
      goal: { objective: "Find the answer" },
      trigger: { type: "immediate" },
      output: { format: "markdown" },
    },
  );

  assert.deepEqual(result, { taskId: "task-1", nextRunAt: "2026-09-30T00:00:00.000Z", status: "active" });
  assert.deepEqual(received.context, {
    userId: "user-from-run",
    sourceSessionId: "session-from-run",
    sourceMessageId: "message-from-run",
    traceId: "trace-from-run",
    timeZone: "Asia/Shanghai",
  });
  assert.deepEqual(received.policy, { defaultTimeoutSeconds: 900, maxTimeoutSeconds: 3600 });
  assert.equal(received.input.agentId, "task-worker");
});
