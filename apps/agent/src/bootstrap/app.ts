import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { AgentRegistry } from "../config/agent-registry.js";
import type { AgentSessionManager } from "../harness/session-manager.js";
import type { AgentTaskRepository } from "../tasks/task-repository.js";
import type { TaskRunner } from "../tasks/task-runner.js";
import { createAgentRoutes } from "../http/agent-route.js";
import { createSessionRoutes } from "../http/session-route.js";
import { createTaskRoutes } from "../http/task-route.js";

export function createApp(token: string, registry: AgentRegistry, sessions: AgentSessionManager, tasks: AgentTaskRepository, runner: TaskRunner): Hono {
  if (!token.trim()) throw new Error("AGENT_TOKEN is required");
  const app = new Hono();
  app.get("/health", c => c.json({ status: "ok" }));
  app.use("/api/*", cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type", "X-User-Id", "X-Trace-Id"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }));
  app.use("/api/*", bearerAuth({ token }));
  app.use("/api/agent/*", bodyLimit({ maxSize: 64 * 1024 }));
  app.route("/api/agent", createSessionRoutes(registry, sessions));
  app.route("/api/agent", createAgentRoutes(registry, sessions));
  app.route("/api/agent", createTaskRoutes(registry, sessions, tasks, runner));
  return app;
}
