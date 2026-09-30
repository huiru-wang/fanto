import { Hono } from "hono";
import type { Task, TaskRun, TaskService } from "../domain/tasks/index.js";
import { requireUserId } from "./request-user.js";

const ok = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });
const notFound = (c: any) => c.json({ success: false, result: null, errorCode: "NOT_FOUND", errorMsg: "Task not found" }, 404);

const toTaskResponse = (task: Task) => ({
  taskId: task.taskId,
  title: task.title,
  goal: task.goal,
  agentId: task.agentId,
  timeoutSeconds: task.timeoutSeconds,
  trigger: task.trigger,
  output: task.output,
  sources: task.sources,
  status: task.status,
  nextRunAt: task.nextRunAt,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});

const toRunResponse = (run: TaskRun) => ({
  runId: run.runId,
  taskId: run.taskId,
  status: run.status,
  scheduledAt: run.scheduledAt,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  result: run.result,
  error: run.error,
});

export function createTaskRoutes(service: TaskService): Hono {
  const app = new Hono();

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
    return task ? c.json(ok(task)) : notFound(c);
  });

  app.post("/tasks/:taskId/resume", async c => {
    const task = await service.resume(requireUserId(c.req.raw), c.req.param("taskId"));
    return task ? c.json(ok(task)) : notFound(c);
  });

  app.delete("/tasks/:taskId", async c => {
    const task = await service.cancel(requireUserId(c.req.raw), c.req.param("taskId"));
    return task ? c.json(ok(task)) : notFound(c);
  });

  return app;
}
