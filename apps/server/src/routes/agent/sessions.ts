import { isInternalAgent } from "../../creative-runtime/model.js";
import { Hono } from "hono";
import type { AgentRegistry } from "../../agent/harness/registry.js";
import { AgentSessionManager } from "../../agent/harness/session-manager.js";
import { sessionError } from "./errors.js";
import { createSessionSchema, cursorSchema, limitSchema, sessionParamsSchema, traceIdSchema } from "./schemas.js";
import { requireUserId } from "../request-user.js";
import { projectHistory } from "../../agent/presentation.js";

export function createSessionRoutes(registry: AgentRegistry, sessions: AgentSessionManager): Hono {
  const app = new Hono();
  app.post("/sessions", async c => {
    const body = createSessionSchema.safeParse(await c.req.json().catch(() => null));
    const userId = requireUserId(c.req.raw);
    const traceId = traceIdSchema.safeParse(c.req.header("x-trace-id"));
    if (!body.success || !traceId.success) return c.json({ error: "agentId or x-trace-id is invalid" }, 400);
    const definition = registry.get(body.data.agentId);
    if (definition && isInternalAgent(definition.id)) return c.json({ error: "Agent is internal" }, 403);
    if (!definition) return c.json({ error: "Agent not found" }, 404);
    const session = await sessions.create(definition, userId);
    return c.json({ success: true, result: { sessionId: session.id, agentId: session.agentId, createdAt: new Date().toISOString(), traceId: traceId.data } }, 201);
  });

  app.get("/sessions/:sessionId/history", async c => {
    const params = sessionParamsSchema.safeParse(c.req.param());
    const cursor = cursorSchema.safeParse(c.req.query("cursor"));
    const limit = limitSchema.safeParse(c.req.query("limit"));
    const userId = requireUserId(c.req.raw);
    if (!params.success || !cursor.success || !limit.success) return c.json({ error: "sessionId, cursor, or limit is invalid" }, 400);
    try {
      const result = await sessions.history(params.data.sessionId, cursor.data, limit.data, userId);
      const definition = registry.get(result.agentId);
      if (!definition) return c.json({ error: "Agent not found" }, 404);
      const tools = sessions.toolsForHistory(definition, params.data.sessionId, userId);
      return c.json({
        success: true,
        result: {
          sessionId: params.data.sessionId,
          agentId: result.agentId,
          data: result.entries.map(redact),
          messages: projectHistory(result.entries, tools),
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
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
