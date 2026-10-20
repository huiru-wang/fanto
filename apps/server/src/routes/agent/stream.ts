import { waitForOutput } from "../../agent/harness/run-output.js";
import { logInfo, logError, logSummary } from "../../infrastructure/logging/logger.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AgentRegistry } from "../../agent/harness/registry.js";
import { runAgent } from "../../agent/harness/run.js";
import type { AgentStreamEvent } from "../../agent/harness/events.js";
import type { AgentSessionManager } from "../../agent/harness/session-manager.js";
import { resolveTimeZone } from "../../agent/context/providers/current-time.js";
import { sessionError } from "./errors.js";
import { streamRequestSchema, traceIdSchema } from "./schemas.js";
import { requireUserId } from "../request-user.js";

export const AGENT_STREAM_TIMEOUT_MS = 10 * 60 * 1000;

export function createAgentRoutes(registry: AgentRegistry, sessions: AgentSessionManager, timeoutMs = AGENT_STREAM_TIMEOUT_MS): Hono {
  const app = new Hono();
  app.post("/stream", async c => {
    const body = streamRequestSchema.safeParse(await c.req.json().catch(() => null));
    const userId = requireUserId(c.req.raw);
    const traceId = traceIdSchema.safeParse(c.req.header("x-trace-id"));
    const timeZone = resolveTimeZone(c.req.header("x-time-zone")?.trim());
    if (!body.success || !traceId.success) {
      return c.json({ error: "sessionId, message, or x-trace-id is invalid" }, 400);
    }
    const runTraceId = traceId.data ?? randomUUID();
    let session;
    let release: ((error?: unknown) => void) | undefined;
    try {
      const agentId = await sessions.resolveAgentId(body.data.sessionId, userId);
      const definition = registry.get(agentId);
      if (!definition) return c.json({ error: "Agent not found" }, 404);
      const acquired=await sessions.acquireForRun(definition,body.data.sessionId,userId);
      session=acquired.session;
      release=acquired.release;
    } catch (cause) {
      return sessionError(c, cause);
    }

    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async stream => {
      const controller = new AbortController();
      const connection = new AbortController();
      stream.onAbort(() => connection.abort());
      const deliver = async (write: () => Promise<void>) => {
        const status = await waitForOutput(write, connection.signal);
        if (status === "timeout") {connection.abort();stream.abort();}
      };
      const timeout = setTimeout(() => controller.abort(new DOMException("run_timeout", "AbortError")), timeoutMs);
      const heartbeat = setInterval(() => {
        void deliver(async () => {await stream.write(": ping\n\n");}).catch(() => connection.abort());
      }, 15_000);

      try {
        try {
          await runAgent(
            session,
            body.data.message,
            controller.signal,
            { traceId: runTraceId, timeZone,  },
            event => deliver(() => writeStreamEvent(stream, event)),
            () => stream.writeSSE({
              event: "start",
              data: JSON.stringify({sessionId:session.id,agentId:session.agentId,traceId:runTraceId}),
            }),
          );
        } finally {
          let persistenceError: unknown;
          try {
            await sessions.checkpoint?.(session.id);
          } catch (cause) {
            persistenceError = cause;
            throw cause;
          } finally {
            // Stop waiters must receive checkpoint failure. Ordinary Pi abort
            // is not a persistence failure and must not poison the next Run.
            release?.(persistenceError);
            release = undefined;
            clearTimeout(timeout);
            clearInterval(heartbeat);
            logInfo("agent-stream", "session released", {userId,sessionId:session.id,agentId:session.agentId,traceId:runTraceId});
          }
        }
        controller.signal.throwIfAborted();
        await deliver(() => stream.writeSSE({ event: "done", data: "{}" }));
      } catch (error) {
        logError("agent-stream", "run failed", {userId, sessionId:session.id, agentId:session.agentId,
          traceId:runTraceId, aborted:controller.signal.aborted || (error instanceof Error && error.name === "AbortError"), error:logSummary(error)});
        if (!stream.aborted) {
          await deliver(() => stream.writeSSE({
            event: error instanceof Error && error.name === "AbortError" ? "stopped" : "error",
            data: error instanceof Error && error.name === "AbortError" ? "{}" : JSON.stringify({error:"Agent run failed"}),
          }));
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

export async function writeStreamEvent(
  stream: { writeSSE: (event: { event: string; data: string }) => Promise<void> },
  event: AgentStreamEvent,
): Promise<void> {
  switch (event.type) {
    case "finalizing":
      await stream.writeSSE({ event: "finalizing", data: "{}" });
      return;
    case "turn_start":
      await stream.writeSSE({ event: "turn_start", data: "{}" });
      return;
    case "message_start":
      await stream.writeSSE({ event: "message_start", data: "{}" });
      return;
    case "message_end":
      await stream.writeSSE({ event: "message_end", data: "{}" });
      return;
    case "tool_start":
      await stream.writeSSE({
        event: "tool_start",
        data: JSON.stringify({ toolCallId: event.toolCallId, toolName: event.toolName, presentation: event.presentation }),
      });
      return;
    case "tool_end":
      await stream.writeSSE({
        event: "tool_end",
        data: JSON.stringify({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: event.status,
          presentation: event.presentation,
          ...(event.result ? { result: event.result } : {}),
        }),
      });
      return;
    case "delta":
      await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: event.text }) });
  }
}
