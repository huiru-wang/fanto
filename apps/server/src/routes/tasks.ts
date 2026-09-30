import { Hono } from "hono";
import type { Task, TaskRun, TaskService } from "../domain/tasks/index.js";
import type { MediaService } from "../domain/media/index.js";
import { requireUserId } from "./request-user.js";

const ok = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });
const notFound = (c: any) => c.json({ success: false, result: null, errorCode: "NOT_FOUND", errorMsg: "Task not found" }, 404);

const toTaskResponse = (task: Task) => ({
  taskId: task.taskId,
  title: task.title,
  goal: task.goal,
  trigger: task.trigger,
  output: task.output,
  status: task.status,
  nextRunAt: task.nextRunAt,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});

const safeRunError = (error: Record<string, unknown> | null) => {
  if (!error) return null;
  const code = typeof error.code === "string" ? error.code : "TASK_EXECUTION_FAILED";
  const message = code === "TASK_TIMEOUT"
    ? "任务执行超时"
    : code === "SERVER_RESTARTED"
      ? "任务执行被中断"
      : code === "TASK_RESULT_NOT_DELIVERED"
        ? "任务没有生成可用结果"
        : "任务执行失败";
  return { code, message };
};

const toRunResponse = (run: TaskRun) => ({
  runId: run.runId,
  taskId: run.taskId,
  status: run.status,
  scheduledAt: run.scheduledAt,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  plan: run.plan,
  result: run.result,
  error: safeRunError(run.error),
});

export function createTaskRoutes(service: TaskService, media?: MediaService): Hono {
  const app = new Hono();

  app.get("/tasks/artifacts/:mediaId/preview", async c => {
    if (!media) return notFound(c);
    const userId = requireUserId(c.req.raw);
    const loaded = await media.readTaskArtifact(userId, c.req.param("mediaId"));
    if (loaded.kind === "too_large") {
      return c.json({ success: false, result: null, errorCode: "ARTIFACT_TOO_LARGE", errorMsg: "Task artifact is too large to preview" }, 413);
    }
    if (loaded.kind !== "ok") return notFound(c);
    const artifact = loaded.artifact;
    const run = await service.findRun(userId, artifact.taskId, artifact.taskRunId);
    const declared = run?.result?.artifacts.some(item => item.mediaId === artifact.mediaId);
    if (!run || !declared) return notFound(c);
    const format = artifact.mimeType === "text/html" ? "html" : artifact.mimeType === "text/markdown" ? "markdown" : "text";
    return c.json(ok({
      mediaId: artifact.mediaId,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      format,
      content: artifact.content,
    }));
  });

  app.get("/tasks", async c => {
    const data = await service.list(requireUserId(c.req.raw));
    return c.json(ok({ data: data.map(toTaskResponse) }));
  });

  app.get("/tasks/:taskId", async c => {
    const task = await service.find(requireUserId(c.req.raw), c.req.param("taskId"));
    return task ? c.json(ok(toTaskResponse(task))) : notFound(c);
  });

  app.get("/tasks/:taskId/runs", async c => {
    const userId = requireUserId(c.req.raw);
    const task = await service.find(userId, c.req.param("taskId"));
    if (!task) return notFound(c);
    const data = await service.listRuns(userId, task.taskId);
    return c.json(ok({ data: data.map(toRunResponse) }));
  });

  app.get("/tasks/:taskId/runs/:runId", async c => {
    const run = await service.findRun(requireUserId(c.req.raw), c.req.param("taskId"), c.req.param("runId"));
    return run
      ? c.json(ok(toRunResponse(run)))
      : c.json({ success: false, result: null, errorCode: "NOT_FOUND", errorMsg: "Task run not found" }, 404);
  });

  app.post("/tasks/:taskId/pause", async c => {
    const task = await service.pause(requireUserId(c.req.raw), c.req.param("taskId"));
    return task ? c.json(ok(toTaskResponse(task))) : notFound(c);
  });

  app.post("/tasks/:taskId/resume", async c => {
    const task = await service.resume(requireUserId(c.req.raw), c.req.param("taskId"));
    return task ? c.json(ok(toTaskResponse(task))) : notFound(c);
  });

  app.delete("/tasks/:taskId", async c => {
    const task = await service.cancel(requireUserId(c.req.raw), c.req.param("taskId"));
    return task ? c.json(ok(toTaskResponse(task))) : notFound(c);
  });

  return app;
}
