import { logInfo, logError, logSummary } from "../../infrastructure/logging/logger.js";
import type { SessionEventBus } from "../../event/session-event-bus.js";
import { streamSSE } from "hono/streaming";
import { writeStreamEvent } from "./stream.js";
import { Hono } from "hono";
import type { AgentRegistry } from "../../agent/harness/registry.js";
import { AgentSessionManager } from "../../agent/harness/session-manager.js";
import { sessionError } from "./errors.js";
import { createSessionSchema, cursorSchema, limitSchema, sessionParamsSchema, traceIdSchema } from "./schemas.js";
import { requireUserId } from "../request-user.js";
import { stopAgentRun } from "../../agent/harness/run.js";
import { projectHistory } from "../../agent/presentation.js";

export function createSessionRoutes(registry: AgentRegistry, sessions: AgentSessionManager, events?: SessionEventBus): Hono {
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

  app.post("/sessions/:sessionId/stop", async c => {
    const params = sessionParamsSchema.safeParse(c.req.param());
    if (!params.success) return c.json({error:"sessionId is invalid"},400);
    const userId = requireUserId(c.req.raw);
    const startedAt = Date.now();
    try {
      await sessions.assertOwnership(params.data.sessionId,userId);
      const stopped = await stopAgentRun(params.data.sessionId);
      await sessions.waitUntilIdle(params.data.sessionId);
      logInfo("agent-stop", "completed", {userId,sessionId:params.data.sessionId,stopped,durationMs:Date.now()-startedAt});
      return c.json({success:true,result:{sessionId:params.data.sessionId,stopped}});
    } catch(error) {
      logError("agent-stop", "failed", {userId,sessionId:params.data.sessionId,error:logSummary(error),durationMs:Date.now()-startedAt});
      return sessionError(c,error);
    }
  });

  app.get("/sessions/:sessionId/events", async c => {
    const userId=requireUserId(c.req.raw), id=c.req.param("sessionId");
    if(!events)return c.json({error:"Events unavailable"},503);
    try{await sessions.assertOwnership(id,userId);}catch(error){return sessionError(c,error);}
    return streamSSE(c,async stream=>{
      const unsubscribe=events.subscribe(id,event=>{
        if(event.type==="start")void stream.writeSSE({event:"start",data:JSON.stringify({sessionId:id,agentId:event.agentId})}).catch(()=>{});
        else if(event.type==="done"||event.type==="stopped"||event.type==="error")void stream.writeSSE({event:event.type,data:JSON.stringify(event.type==="error"?{error:event.message??"Agent run failed"}:{})}).catch(()=>{});
        else void writeStreamEvent(stream,event).catch(()=>{});
      });
      const heartbeat=setInterval(()=>void stream.write(": ping\n\n").catch(()=>{}),15000);
      try{await new Promise<void>(resolve=>stream.onAbort(resolve));}
      finally{clearInterval(heartbeat);unsubscribe();}
    });
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
          data: result.entries.filter(entry => !(entry.type === "custom" && entry.customType === "fanto.run_stopped")).map(redact),
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
