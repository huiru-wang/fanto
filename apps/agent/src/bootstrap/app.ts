import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import type { AgentRegistry } from "../config/agent-registry.js";
import type { AgentSessionManager } from "../harness/session-manager.js";
import { createAgentRoutes } from "../http/agent-route.js";

export function createApp(token: string, registry: AgentRegistry, sessions: AgentSessionManager): Hono {
  if (!token.trim()) throw new Error("AGENT_TOKEN is required");
  const app = new Hono();
  app.get("/health", c => c.json({ status: "ok" }));
  app.use("/api/*", bearerAuth({ token }));
  app.use("/api/agent", bodyLimit({ maxSize: 64 * 1024 }));
  app.route("/api", createAgentRoutes(registry, sessions));
  return app;
}
