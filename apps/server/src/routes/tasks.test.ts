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
    extData: { worker: { host: "internal" }, plan: { internal: true } },
    plan: {
      summary: "先整理素材，再生成结果。",
      steps: [{ id: "one", title: "整理素材" }],
      createdAt: "2026-09-29T10:05:00.000Z",
      updatedAt: "2026-09-29T10:05:00.000Z",
      version: 1,
    },
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
  assert.deepEqual(body.result.plan, {
    summary: "先整理素材，再生成结果。",
    steps: [{ id: "one", title: "整理素材" }],
    createdAt: "2026-09-29T10:05:00.000Z",
    updatedAt: "2026-09-29T10:05:00.000Z",
    version: 1,
  });
  assert.deepEqual(body.result.result, {
    summary: "done",
    artifacts: [{ filename: "result.md", role: "primary", mediaId: "media-1", mimeType: "text/markdown", bytes: 4, checksum: "sha256:test" }],
  });
  assert.equal("workerSessionId" in body.result, false);
  assert.equal("extData" in body.result, false);
});


test("Task artifact preview verifies declared task run ownership before returning content", async () => {
  const service = {
    findRun: async (userId: string, taskId: string, runId: string) => {
      assert.equal(userId, "user-1");
      assert.equal(taskId, "task-1");
      assert.equal(runId, "run-1");
      return {
        runId,
        taskId,
        result: {
          summary: "done",
          artifacts: [{ filename: "result.html", role: "primary", mediaId: "media-1", mimeType: "text/html", bytes: 12, checksum: "sha256:test" }],
        },
      } as unknown as TaskRun;
    },
  } as unknown as TaskService;
  const media = {
    readTaskArtifact: async (userId: string, mediaId: string) => {
      assert.equal(userId, "user-1");
      assert.equal(mediaId, "media-1");
      return {
        kind: "ok" as const,
        artifact: {
          mediaId: "media-1",
          taskId: "task-1",
          taskRunId: "run-1",
          filename: "result.html",
          mimeType: "text/html" as const,
          bytes: 12,
          content: "<html></html>",
        },
      };
    },
  } as any;
  const app = createTaskRoutes(service, media);

  const response = await runWithRequestPrincipal(
    { userId: "user-1", source: "user" },
    () => app.request("http://localhost/tasks/artifacts/media-1/preview"),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.result, {
    mediaId: "media-1",
    filename: "result.html",
    mimeType: "text/html",
    format: "html",
    content: "<html></html>",
  });
});

test("Task artifact preview hides undeclared artifacts", async () => {
  const service = {
    findRun: async () => ({
      result: { summary: "done", artifacts: [] },
    } as unknown as TaskRun),
  } as unknown as TaskService;
  const media = {
    readTaskArtifact: async () => ({
      kind: "ok" as const,
      artifact: {
        mediaId: "media-1", taskId: "task-1", taskRunId: "run-1", filename: "result.md",
        mimeType: "text/markdown" as const, bytes: 4, content: "# hi",
      },
    }),
  } as any;
  const app = createTaskRoutes(service, media);
  const response = await runWithRequestPrincipal(
    { userId: "user-1", source: "user" },
    () => app.request("http://localhost/tasks/artifacts/media-1/preview"),
  );
  assert.equal(response.status, 404);
});
