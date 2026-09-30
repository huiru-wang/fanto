import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Task, TaskRun } from "../domain/tasks/index.js";
import { TaskResultPublisher } from "./result-publisher.js";

const task = {
  taskId: "task-1",
  output: { format: "html" },
} as Task;

const run = {
  runId: "run-1",
  userId: "user-1",
} as TaskRun;

test("TaskResultPublisher uploads declared workspace files and returns an auditable result", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "fanto-task-result-"));
  const uploads: Array<{ filename: string; workerSessionId: string; data: string }> = [];
  const publisher = new TaskResultPublisher({
    createTaskGeneratedFile: async (input: any) => {
      uploads.push({ filename: input.filename, workerSessionId: input.workerSessionId, data: input.data.toString("utf8") });
      return { mediaId: `media-${input.filename}` };
    },
  } as never);

  try {
    await writeFile(join(workspace, "result.html"), "<!doctype html>\n<html lang=\"zh-CN\"><body>hello</body></html>");
    await writeFile(join(workspace, "notes.md"), "# Notes");

    const result = await publisher.publish(task, run, workspace, "worker-session-1", {
      summary: "已完成贺卡页面。",
      artifacts: [
        { path: "result.html", role: "primary" },
        { path: "notes.md", role: "supplementary" },
      ],
    });

    assert.equal(result.primaryMediaId, "media-result.html");
    assert.deepEqual(uploads.map(upload => upload.filename), ["result.html", "notes.md"]);
    assert.ok(uploads.every(upload => upload.workerSessionId === "worker-session-1"));
    assert.deepEqual(result.result.artifacts.map(artifact => artifact.filename), ["result.html", "notes.md"]);
    assert.deepEqual(result.result.artifacts.map(artifact => artifact.mimeType), ["text/html", "text/markdown"]);
    assert.ok(result.result.artifacts.every(artifact => artifact.checksum.startsWith("sha256:")));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("TaskResultPublisher rejects HTML without an HTML document root", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "fanto-task-result-"));
  const publisher = new TaskResultPublisher({ createTaskGeneratedFile: async () => ({ mediaId: "unused" }) } as never);
  try {
    await writeFile(join(workspace, "result.html"), "<body>not a document</body>");
    await assert.rejects(
      () => publisher.publish(task, run, workspace, "worker-session-1", {
        summary: "已完成。",
        artifacts: [{ path: "result.html", role: "primary" }],
      }),
      /不是有效的 HTML 起始结构/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("TaskResultPublisher gives the Worker a retryable error for a missing file", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "fanto-task-result-"));
  const publisher = new TaskResultPublisher({ createTaskGeneratedFile: async () => ({ mediaId: "unused" }) } as never);
  try {
    await assert.rejects(
      () => publisher.publish(task, run, workspace, "worker-session-1", {
        summary: "已完成。",
        artifacts: [{ path: "result.html", role: "primary" }],
      }),
      /请先在当前工作区以相对路径写入该文件，再重新调用 deliver_task_result/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
