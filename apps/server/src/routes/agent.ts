import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { SessionManager } from "../agent/session.js";
import type { AppConfig } from "../env.js";
import type { MessageRepository } from "../modules/message/message.repository.js";
import { requireUserId } from "../interfaces/request-user.js";

const input = z.object({ sessionId: z.string().min(1), message: z.string().min(1) }).strict();

export function createAgentRoutes(sessionManager: SessionManager, config: AppConfig, messageRepo: MessageRepository): Hono {
  const app = new Hono();
  app.post("/stream", async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400);
    const userId = requireUserId(c.req.raw);
    const thread = await sessionManager.getOrCreate(userId, body.data.sessionId, { config, messageRepo, userId, ...body.data });
    return streamSSE(c, async (stream) => {
      const unsubscribe = thread.runtime.agent.subscribe(async (event: AgentEvent) => {
        await stream.writeSSE({ data: JSON.stringify(event), event: event.type });
      });
      try {
        await thread.runtime.agent.prompt(body.data.message);
        await thread.runtime.agent.waitForIdle();
        await stream.writeSSE({ data: "[DONE]", event: "done" });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Unknown error";
        await stream.writeSSE({ data: JSON.stringify({ error: message }), event: "error" });
      } finally {
        unsubscribe();
      }
    });
  });
  return app;
}
