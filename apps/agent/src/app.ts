import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { AgentRegistry } from "./agent/registry.js";
import type { AgentSessionManager } from "./agent/session.js";
import type { ContextRuntime } from "./context/runtime.js";
import { createSessionRoutes } from "./http/sessions.js";
import { createAgentRoutes } from "./http/stream.js";
import { bearerToken, runWithAgentPrincipal, type AccessTokenVerifier } from "./auth/access.js";

export function createApp(
  verifier: AccessTokenVerifier,
  registry: AgentRegistry,
  sessions: AgentSessionManager,
  contextRuntime?: ContextRuntime,
): Hono {
  const app = new Hono();

  app.get("/health", c => c.json({ status: "ok" }));
  app.use("/api/*", cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type", "X-Trace-Id", "X-Time-Zone"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }));
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const token = bearerToken(c.req.raw);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    try {
      const verified = await verifier.verify(token);
      await runWithAgentPrincipal({ userId: verified.userId, token }, next);
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
  });
  app.use("/api/agent/*", bodyLimit({ maxSize: 64 * 1024 }));

  app.route("/api/agent", createSessionRoutes(registry, sessions));
  app.route("/api/agent", createAgentRoutes(registry, sessions, contextRuntime));
  return app;
}
