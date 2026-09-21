import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AgentRegistry } from "../agent/registry.js";
import { runAgent, type AgentStreamEvent } from "../agent/run.js";
import type { AgentSessionManager } from "../agent/session.js";
import type { ContextRuntime } from "../context/runtime.js";
import { resolveTimeZone } from "../context/providers/time.js";
import { sessionError } from "./errors.js";
import { streamRequestSchema, traceIdSchema, userIdSchema } from "./schemas.js";

export function createAgentRoutes(
  registry: AgentRegistry,
  sessions: AgentSessionManager,
  contextRuntime?: ContextRuntime,
): Hono {
  const app = new Hono();
  app.post("/stream", async c => {
    const body = streamRequestSchema.safeParse(await c.req.json().catch(() => null));
    const userId = userIdSchema.safeParse(c.req.header("x-user-id"));
    const traceId = traceIdSchema.safeParse(c.req.header("x-trace-id"));
    const timeZone = resolveTimeZone(c.req.header("x-time-zone")?.trim());
    if (!body.success || !userId.success || !traceId.success) {
      return c.json({ error: "agentId, sessionId, message, x-user-id, or x-trace-id is invalid" }, 400);
    }
    const definition = registry.get(body.data.agentId);
    if (!definition) return c.json({ error: "Agent not found" }, 404);

    let session;
    let release: (() => void) | undefined;
    try {
      session = await sessions.acquire(definition, body.data.sessionId, userId.data);
      release = sessions.reserve(session);
    } catch (cause) {
      return sessionError(c, cause);
    }

    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async stream => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      const timeout = setTimeout(() => controller.abort(), 120_000);
      const heartbeat = setInterval(() => {
        void stream.write(": ping\n\n").catch(() => controller.abort());
      }, 15_000);

      try {
        await stream.writeSSE({
          event: "start",
          data: JSON.stringify({ sessionId: session.id, agentId: session.agentId, traceId: traceId.data }),
        });
        await runAgent(
          session,
          body.data.message,
          controller.signal,
          { traceId: traceId.data, timeZone },
          contextRuntime,
          event => writeStreamEvent(stream, event),
        );
        controller.signal.throwIfAborted();
        await stream.writeSSE({ event: "done", data: "{}" });
      } catch {
        if (!stream.aborted) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: controller.signal.aborted ? "Request timed out" : "Agent run failed" }),
          });
        }
      } finally {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        release?.();
      }
    });
  });
  return app;
}

async function writeStreamEvent(
  stream: { writeSSE: (event: { event: string; data: string }) => Promise<void> },
  event: AgentStreamEvent,
): Promise<void> {
  switch (event.type) {
    case "turn_start":
      await stream.writeSSE({ event: "turn_start", data: "{}" });
      return;
    case "tool_start":
      await stream.writeSSE({
        event: "tool_start",
        data: JSON.stringify({ toolCallId: event.toolCallId, toolName: event.toolName }),
      });
      return;
    case "tool_end":
      await stream.writeSSE({
        event: "tool_end",
        data: JSON.stringify({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: event.status,
          ...(event.result ? { result: event.result } : {}),
        }),
      });
      return;
    case "delta":
      await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: event.text }) });
  }
}
