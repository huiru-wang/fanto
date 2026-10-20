import { logInfo, logError, logSummary } from "../../infrastructure/logging/logger.js";
import { Hono } from "hono";
import type { AgentRegistry } from "../../agent/harness/registry.js";
import { AgentSessionManager, SessionNotFoundError, SessionOwnershipError, SessionBusyError } from "../../agent/harness/session-manager.js";
import { sessionError } from "./errors.js";
import { createSessionSchema, cursorSchema, limitSchema, sessionParamsSchema, traceIdSchema } from "./schemas.js";
import { requireUserId } from "../request-user.js";
import { requestAgentStop, isAgentStopping } from "../../agent/harness/run.js";
import { projectHistory } from "../../agent/presentation.js";

export function createSessionRoutes(registry: AgentRegistry, sessions: AgentSessionManager, stopTimeoutMs = 20_000): Hono {
  const app = new Hono();
  app.post("/sessions", async c => {
    const body = createSessionSchema.safeParse(await c.req.json().catch(() => null));
    const userId = requireUserId(c.req.raw);
    const traceId = traceIdSchema.safeParse(c.req.header("x-trace-id"));
    if (!body.success || !traceId.success) return c.json({ error: "agentId or x-trace-id is invalid" }, 400);
    const definition = registry.get(body.data.agentId);
    if (!definition) return c.json({ error: "Agent not found" }, 404);
    const session = await sessions.create(definition, userId);
    return c.json({ success: true, result: { sessionId: session.id, agentId: session.agentId, createdAt: new Date().toISOString(), traceId: traceId.data } }, 201);
  });

  app.get("/sessions", async c => {
    const userId = requireUserId(c.req.raw);
    const agentId = c.req.query("agentId") ?? "main";
    const limit = limitSchema.safeParse(c.req.query("limit"));
    const cursor = c.req.query("cursor");
    if (!limit.success || !registry.get(agentId) || (cursor !== undefined && !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)))
      return c.json({ error: "Invalid session list query" }, 400);
    try {
      const result = await sessions.list(userId, agentId, cursor, limit.data);
      return c.json({ success: true, result });
    } catch (cause) {
      if (cause instanceof Error && cause.message === "Invalid session list cursor")
        return c.json({ error: cause.message }, 400);
      return sessionError(c, cause);
    }
  });

  app.post("/sessions/:sessionId/stop", async c => {
    const params = sessionParamsSchema.safeParse(c.req.param());
    if (!params.success) return c.json({error:"sessionId is invalid"},400);
    const userId = requireUserId(c.req.raw);
    const startedAt = Date.now();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = async () => {
      await sessions.assertOwnership(params.data.sessionId,userId);
      // Ownership may finish after the response deadline: never cancel a later turn.
      if (expired) throw new Error("STOP_NOT_CONFIRMED");
      logInfo("agent-stop", "requested", {userId,sessionId:params.data.sessionId});
      const result = requestAgentStop(params.data.sessionId);
      if (result.stopping && !result.waitingForTools) {
        // Allow cheap in-memory cancellation to finish; never wait for a running tool.
        await Promise.race([sessions.waitUntilIdle(params.data.sessionId), new Promise<void>(resolve => setTimeout(resolve, 30))]);
      }
      return { stopped: result.accepted, stopping: sessions.isRunning(params.data.sessionId) };
    };
    try {
      const result = await Promise.race([stop(), new Promise<never>((_,reject) => {
        timer=setTimeout(() => {expired=true;reject(new Error("STOP_NOT_CONFIRMED"));},stopTimeoutMs);
      })]);
      return c.json({success:true,result:{sessionId:params.data.sessionId,...result}}, result.stopping ? 202 : 200);
    } catch(error) {
      logError("agent-stop", "failed", {userId,sessionId:params.data.sessionId,error:logSummary(error),durationMs:Date.now()-startedAt});
      if (expired || !(error instanceof SessionNotFoundError || error instanceof SessionOwnershipError || error instanceof SessionBusyError)) return c.json({error:"停止尚未确认，请重试。"},503);
      return sessionError(c,error);
    } finally {clearTimeout(timer);}
  });

  app.get("/sessions/:sessionId/history", async c => {
    const params = sessionParamsSchema.safeParse(c.req.param());
    const cursor = cursorSchema.safeParse(c.req.query("cursor"));
    const limit = limitSchema.safeParse(c.req.query("limit"));
    const userId = requireUserId(c.req.raw);
    if (!params.success || !cursor.success || !limit.success) return c.json({ error: "sessionId, cursor, or limit is invalid" }, 400);
    try {
      const running = sessions.isRunning(params.data.sessionId);
      const result = await sessions.history(params.data.sessionId, cursor.data, limit.data, userId);
      const definition = registry.get(result.agentId);
      if (!definition) return c.json({ error: "Agent not found" }, 404);
      const tools = sessions.toolsForHistory(definition, params.data.sessionId, userId);
      return c.json({
        success: true,
        result: {
          sessionId: params.data.sessionId,
          agentId: result.agentId,
          data: result.entries.filter(entry => !(entry.type === "custom" && entry.customType === "fanto.run_stopped")).map(redact),
          messages: projectHistory(result.entries, tools),
          running,
          stopping: isAgentStopping(params.data.sessionId),
          restored: sessions.restored?.(params.data.sessionId) ?? false,
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
