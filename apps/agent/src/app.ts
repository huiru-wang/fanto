import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { AgentRegistry } from "./agent/registry.js";
import type { AgentSessionManager } from "./agent/session.js";
import type { ContextRuntime } from "./context/runtime.js";
import { createSessionRoutes } from "./http/sessions.js";
import { createAgentRoutes } from "./http/stream.js";
import { createTaskRoutes } from "./http/tasks.js";
import type { AgentTaskRepository } from "./tasks/repository.js";
import type { TaskRunner } from "./tasks/runner.js";

export function createApp(
  token: string,
  registry: AgentRegistry,
  sessions: AgentSessionManager,
  tasks: AgentTaskRepository,
  runner: TaskRunner,
  allowedUserIds?: ReadonlySet<string>,
  contextRuntime?: ContextRuntime,
): Hono {
  if (!token.trim()) throw new Error("AGENT_TOKEN is required");
  const app = new Hono();

  app.get("/health", c => c.json({ status: "ok" }));
  app.use("/api/*", cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type", "X-User-Id", "X-Trace-Id", "X-Time-Zone"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }));
  app.use("/api/*", bearerAuth({ token }));
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const userId = c.req.header("x-user-id")?.trim();
    if (allowedUserIds && (!userId || !allowedUserIds.has(userId))) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });
  app.use("/api/agent/*", bodyLimit({ maxSize: 64 * 1024 }));

  app.route("/api/agent", createSessionRoutes(registry, sessions));
  app.route("/api/agent", createAgentRoutes(registry, sessions, contextRuntime));
  app.route("/api/agent", createTaskRoutes(registry, sessions, tasks, runner));
  return app;
}
