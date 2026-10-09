import { isInternalAgent } from "../../domain/projects/creative-model.js";
import type { ProjectService } from "../../domain/projects/project-service.js";
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

export function createAgentRoutes(
  registry: AgentRegistry,
  sessions: AgentSessionManager,
  projects?: ProjectService,
): Hono {
  const app = new Hono();
  app.post("/stream", async c => {
    const body = streamRequestSchema.safeParse(await c.req.json().catch(() => null));
    const userId = requireUserId(c.req.raw);
    const traceId = traceIdSchema.safeParse(c.req.header("x-trace-id"));
    const timeZone = resolveTimeZone(c.req.header("x-time-zone")?.trim());
    if (!body.success || !traceId.success) {
      return c.json({ error: "agentId, sessionId, message, or x-trace-id is invalid" }, 400);
    }
    const runTraceId = traceId.data ?? randomUUID();
    const definition = registry.get(body.data.agentId);
    if (definition && isInternalAgent(definition.id) && definition.id !== "creator-agent") return c.json({ error: "Agent is internal" }, 403);
    const project = definition?.id === "creator-agent" ? await projects?.findBySession(userId, body.data.sessionId) : null;
    if (definition?.id === "creator-agent" && (!project || !["completed", "failed"].includes(project.status))) return c.json({ error: "Project is not ready" }, 409);
    if (!definition) return c.json({ error: "Agent not found" }, 404);

    let session;
    let release: (() => void) | undefined;
    try {
      session = await sessions.acquire(definition, body.data.sessionId, userId, { internal: !!project });
      release = sessions.reserve(session);
      if (project && !await projects!.claimExecution(userId, project.projectId, ["completed", "failed"], "running")) {
        release();
        return c.json({ error: "Project busy" }, 409);
      }
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
          data: JSON.stringify({ sessionId: session.id, agentId: session.agentId, traceId: runTraceId }),
        });
        await runAgent(
          session,
          body.data.message,
          controller.signal,
          { traceId: runTraceId, timeZone, ...(project ? { projectId: project.projectId } : {}) },
          event => writeStreamEvent(stream, event),
        );
        controller.signal.throwIfAborted();
        if (project) await projects!.finishExecution(userId, project.projectId, "completed");
        await stream.writeSSE({ event: "done", data: "{}" });
      } catch {
        if (project) await projects!.finishExecution(userId, project.projectId, "failed").catch(() => {});
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
        if (project) await sessions.release(session.id).catch(() => {});
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
