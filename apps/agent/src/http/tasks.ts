import { Hono } from "hono";
import type { AgentRegistry } from "../agent/registry.js";
import { AgentSessionManager } from "../agent/session.js";
import { resolveTimeZone } from "../context/providers/time.js";
import { AgentTaskRepository } from "../tasks/repository.js";
import { TaskRunner } from "../tasks/runner.js";
import { sessionError } from "./errors.js";
import { taskParamsSchema, taskRequestSchema, traceIdSchema, userIdSchema } from "./schemas.js";

export function createTaskRoutes(registry: AgentRegistry, sessions: AgentSessionManager, tasks: AgentTaskRepository, runner: TaskRunner): Hono {
  const app = new Hono();
  app.post("/tasks", async c => {
    const body = taskRequestSchema.safeParse(await c.req.json().catch(() => null));
    const userId = userIdSchema.safeParse(c.req.header("x-user-id"));
    const traceId = traceIdSchema.safeParse(c.req.header("x-trace-id"));
    const timeZone = resolveTimeZone(c.req.header("x-time-zone")?.trim());
    if (!body.success || !userId.success || !traceId.success) return c.json({ error: "agentId, sessionId, message, x-user-id, or x-trace-id is invalid" }, 400);
    const definition = registry.get(body.data.agentId);
    if (!definition) return c.json({ error: "Agent not found" }, 404);
    try {
      await sessions.acquire(definition, body.data.sessionId, userId.data);
    } catch (cause) {
      return sessionError(c, cause);
    }
    const task = tasks.create({ sessionId: body.data.sessionId, agentId: definition.id, message: body.data.message, traceId: traceId.data, timeZone });
    runner.wake();
    return c.json({ success: true, result: taskMetadata(task) }, 202);
  });

  app.get("/tasks/:taskId", async c => {
    const params = taskParamsSchema.safeParse(c.req.param());
    const userId = userIdSchema.safeParse(c.req.header("x-user-id"));
    if (!params.success || !userId.success) return c.json({ error: "taskId or x-user-id is invalid" }, 400);
    const task = tasks.get(params.data.taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);
    try {
      await sessions.assertOwnership(task.sessionId, userId.data);
    } catch (cause) {
      return sessionError(c, cause);
    }
    return c.json({ success: true, result: task });
  });
  return app;
}

function taskMetadata(task: { id: string; sessionId: string; agentId: string; status: string; createdAt: string }) {
  return { id: task.id, sessionId: task.sessionId, agentId: task.agentId, status: task.status, createdAt: task.createdAt };
}
