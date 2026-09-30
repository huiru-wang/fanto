import assert from "node:assert/strict";
import test from "node:test";
import type { TaskRun, TaskService } from "../domain/tasks/index.js";
import { runWithRequestPrincipal } from "./request-user.js";
import { createTaskRoutes } from "./tasks.js";

test("TaskRun HTTP response exposes declared result artifacts without worker internals", async () => {
  const run = {
    runId: "run-1",
    taskId: "task-1",
    userId: "user-1",
    status: "completed",
    scheduledAt: "2026-09-29T10:00:00.000Z",
    workerSessionId: "internal-session",
    resultMediaId: "media-1",
    result: { summary: "done", artifacts: [{ filename: "result.md", role: "primary", mediaId: "media-1", mimeType: "text/markdown", bytes: 4, checksum: "sha256:test" }] },
    error: null,
    extData: { worker: { host: "internal" } },
    startedAt: "2026-09-29T10:05:00.000Z",
    finishedAt: "2026-09-29T10:05:30.000Z",
  } as unknown as TaskRun;
  const service = {
    findRun: async (userId: string, taskId: string, runId: string) => {
      assert.equal(userId, "user-1");
      assert.equal(taskId, "task-1");
      assert.equal(runId, "run-1");
      return run;
    },
  } as unknown as TaskService;
  const app = createTaskRoutes(service);

  const response = await runWithRequestPrincipal(
    { userId: "user-1", source: "user" },
    () => app.request("http://localhost/tasks/task-1/runs/run-1"),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.result.result, {
    summary: "done",
    artifacts: [{ filename: "result.md", role: "primary", mediaId: "media-1", mimeType: "text/markdown", bytes: 4, checksum: "sha256:test" }],
  });
  assert.equal("workerSessionId" in body.result, false);
  assert.equal("extData" in body.result, false);
});
