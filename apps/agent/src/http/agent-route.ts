import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Entry } from "@earendil-works/pi-agent-core";
import type { AgentRegistry } from "../config/agent-registry.js";
import { AgentSessionManager, SessionAgentMismatchError, SessionBusyError, SessionNotFoundError } from "../harness/session-manager.js";
import { agentRequestSchema, cursorSchema, limitSchema, sessionParamsSchema } from "./schemas.js";

export function createAgentRoutes(registry: AgentRegistry, sessions: AgentSessionManager): Hono {
  const app = new Hono();
  app.post("/agent", async c => {
    const body = agentRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "agentId, message, or sessionId is invalid" }, 400);
    const definition = registry.get(body.data.agentId);
    if (!definition) return c.json({ error: "Agent not found" }, 404);
    let session;
    let release: (() => void) | undefined;
    try {
      session = await sessions.acquire(definition, body.data.sessionId);
      release = sessions.reserve(session);
    } catch (cause) {
      return sessionError(c, cause);
    }
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async stream => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      const timeout = setTimeout(() => controller.abort(), 120_000);
      const heartbeat = setInterval(() => { void stream.write(": ping\n\n").catch(() => controller.abort()); }, 15_000);
      try {
        await stream.writeSSE({ event: "start", data: JSON.stringify({ sessionId: session.id, agentId: session.agentId }) });
        await sessions.prompt(session, body.data.message, controller.signal, async delta => {
          await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: delta }) });
        });
        controller.signal.throwIfAborted();
        await stream.writeSSE({ event: "done", data: "{}" });
      } catch {
        if (!stream.aborted) await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: controller.signal.aborted ? "Request timed out" : "Agent run failed" }),
        });
      } finally {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        release?.();
      }
    });
  });

  app.get("/sessions/:sessionId/messages", async c => {
    const params = sessionParamsSchema.safeParse(c.req.param());
    const cursor = cursorSchema.safeParse(c.req.query("cursor"));
    const limit = limitSchema.safeParse(c.req.query("limit"));
    if (!params.success || !cursor.success || !limit.success) return c.json({ error: "sessionId, cursor, or limit is invalid" }, 400);
    try {
      const result = await sessions.entries(params.data.sessionId, cursor.data, limit.data + 2);
      const data = result.entries.filter(entry => !(entry.type === "custom" && entry.customType === "fanto.agent_config")).map(redact);
      const page = data.slice(0, limit.data);
      const last = page.at(-1) as Entry | undefined;
      return c.json({
        success: true,
        result: {
          sessionId: params.data.sessionId,
          agentId: result.agentId,
          data: page,
          hasMore: data.length > limit.data,
          nextCursor: data.length > limit.data ? last?.seq ?? null : null,
        },
      });
    } catch (cause) {
      return sessionError(c, cause);
    }
  });
  return app;
}

function sessionError(c: { json: (value: unknown, status: 404 | 409) => Response }, cause: unknown): Response {
  if (cause instanceof SessionNotFoundError) return c.json({ error: "Session not found" }, 404);
  if (cause instanceof SessionAgentMismatchError) return c.json({ error: "Session belongs to another agent" }, 409);
  if (cause instanceof SessionBusyError) return c.json({ error: "Session is already running" }, 409);
  throw cause;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    /authorization|password|secret|token|api.?key/i.test(key) ? [key, "[REDACTED]"] : [key, redact(item)],
  ));
}
