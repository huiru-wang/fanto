import { Hono } from "hono";
import type { AgentRegistry } from "../agent/registry.js";
import { AgentSessionManager } from "../agent/session.js";
import { sessionError } from "./errors.js";
import { createSessionSchema, cursorSchema, limitSchema, sessionParamsSchema, traceIdSchema, userIdSchema } from "./schemas.js";

export function createSessionRoutes(registry: AgentRegistry, sessions: AgentSessionManager): Hono {
  const app = new Hono();
  app.post("/sessions", async c => {
    const body = createSessionSchema.safeParse(await c.req.json().catch(() => null));
    const userId = userIdSchema.safeParse(c.req.header("x-user-id"));
    const traceId = traceIdSchema.safeParse(c.req.header("x-trace-id"));
    if (!body.success || !userId.success || !traceId.success) return c.json({ error: "agentId, x-user-id, or x-trace-id is invalid" }, 400);
    const definition = registry.get(body.data.agentId);
    if (!definition) return c.json({ error: "Agent not found" }, 404);
    const session = await sessions.create(definition, userId.data);
    return c.json({ success: true, result: { sessionId: session.id, agentId: session.agentId, createdAt: new Date().toISOString(), traceId: traceId.data } }, 201);
  });

  app.get("/sessions/:sessionId/history", async c => {
    const params = sessionParamsSchema.safeParse(c.req.param());
    const cursor = cursorSchema.safeParse(c.req.query("cursor"));
    const limit = limitSchema.safeParse(c.req.query("limit"));
    const userId = userIdSchema.safeParse(c.req.header("x-user-id"));
    if (!params.success || !cursor.success || !limit.success || !userId.success) return c.json({ error: "sessionId, cursor, limit, or x-user-id is invalid" }, 400);
    try {
      const result = await sessions.history(params.data.sessionId, cursor.data, limit.data, userId.data);
      return c.json({
        success: true,
        result: { sessionId: params.data.sessionId, agentId: result.agentId, data: result.entries.map(redact), hasMore: result.hasMore, nextCursor: result.nextCursor },
      });
    } catch (cause) {
      return sessionError(c, cause);
    }
  });
  return app;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    /authorization|password|secret|token|api.?key/i.test(key) ? [key, "[REDACTED]"] : [key, redact(item)],
  ));
}
