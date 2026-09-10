import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Entry } from "@earendil-works/pi-agent-core";
import type { AgentHarnessManager } from "../agent/harness-manager.js";
import { requireUserId } from "../interfaces/request-user.js";

const input = z.object({ sessionId: z.string().uuid(), message: z.string().min(1) }).strict();
const params = z.object({ sessionId: z.string().uuid() });
const cursor = z.coerce.number().int().nonnegative().default(0);
const limit = z.coerce.number().int().min(1).max(100).default(50);

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => /authorization|password|secret|token|api.?key/i.test(key) ? [key, "[REDACTED]"] : [key, redact(item)]));
};

export function createAgentRoutes(sessions: AgentHarnessManager): Hono {
  const app = new Hono();
  app.post("/stream", async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400);
    const thread = await sessions.getOrCreate(requireUserId(c.req.raw), body.data.sessionId);
    if (!thread) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Session not found" }, 404);
    const previous = await thread.harness.session.findEntries({ order: "newestFirst", limit: 1 });
    const afterSeq = previous[0]?.seq ?? 0;
    return streamSSE(c, async (stream) => {
      const unsubscribe = thread.harness.events.on("run_start", event => stream.writeSSE({ event: "run_start", data: JSON.stringify(event) }));
      try {
        const outcome = await thread.harness.prompt(body.data.message);
        const entries = await thread.harness.session.findEntries({ order: "oldestFirst", cursor: { afterSeq } });
        for (const entry of entries) await stream.writeSSE({ event: "entry", data: JSON.stringify(redact(entry)) });
        await stream.writeSSE({ event: "done", data: JSON.stringify(outcome) });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Unknown error";
        await stream.writeSSE({ data: JSON.stringify({ error: message }), event: "error" });
      } finally {
        unsubscribe();
      }
    });
  });
  app.get("/sessions/:sessionId/messages", async c => {
    const path = params.safeParse(c.req.param()); const after = cursor.safeParse(c.req.query("cursor")); const take = limit.safeParse(c.req.query("limit"));
    if (!path.success || !after.success || !take.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid sessionId, cursor, or limit" }, 400);
    const entries = await sessions.entries(requireUserId(c.req.raw), path.data.sessionId, after.data, take.data + 1);
    if (!entries) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Session not found" }, 404);
    const data = entries.slice(0, take.data).map(entry => redact(entry));
    const last = data.at(-1) as Entry | undefined;
    return c.json({ success: true, result: { data, hasMore: entries.length > take.data, nextCursor: entries.length > take.data ? last?.seq ?? null : null }, errorCode: null, errorMsg: null });
  });
  return app;
}
