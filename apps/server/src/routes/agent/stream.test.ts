import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAgentRoutes, AGENT_STREAM_TIMEOUT_MS } from "./stream.js";
import { runWithRequestPrincipal } from "../request-user.js";
import { SessionNotFoundError, SessionOwnershipError } from "../../agent/harness/session-manager.js";
import { createRunContext } from "../../agent/context/run-context.js";

const sessionId = randomUUID();

function route(persisted: Promise<void> = Promise.resolve()) {
  const handlers = new Map<string, (event: any) => Promise<void>>();
  let released = false;
  let observed: ReturnType<typeof createRunContext.read> | undefined;
  const session = {
    id: sessionId, userId: "owner", agentId: "main",
    runtime: {
      readRecentMessages: async () => [],
      harness: { events: { on: (name: string, handler: (event: any) => Promise<void>) => { handlers.set(name, handler); return () => handlers.delete(name); } } },
      tools: [], abort: async () => {},
      prompt: async (_: string, context: Parameters<typeof createRunContext.read>[0]) => {
        observed = createRunContext.read(context);
        await handlers.get("message_end")?.({ message: { role: "assistant", stopReason: "stop" } });
        await persisted;
        return { ok: true, value: { status: "completed" } };
      },
    },
  };
  const sessions = {
    resolveAgentId: async (id: string, userId: string) => {
      if (id !== sessionId) throw new SessionNotFoundError();
      if (userId !== "owner") throw new SessionOwnershipError();
      return "main";
    },
    acquire: async (definition: { id: string }) => { assert.equal(definition.id, "main"); return session; },
    reserve: () => () => { released = true; },
  };
  const registry = { get: (id: string) => id === "main" ? { id, revision: "v1" } : undefined };
  return { app: createAgentRoutes(registry as never, sessions as never), observed: () => observed, released: () => released };
}

const request = (app: ReturnType<typeof createAgentRoutes>, userId: string, body: unknown) => runWithRequestPrincipal(
  { userId, source: "user" },
  () => app.request("/stream", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }),
);

test("Stream resolves Main identity from the owned Session", async () => {
  const { app, observed } = route();
  const response = await request(app, "owner", { sessionId, message: "继续" });
  assert.equal(response.status, 200);
  const payload = await response.text();
  assert.match(payload, /event: done/);
  assert.equal(observed()?.sessionId, sessionId);
});

test("Stream rejects client agentId, record authorities and retired metadata", async () => {
  const { app } = route();
  for (const input of [
    { sessionId, message: "hi", agentId: "main" },
    { sessionId, message: "hi", metadata: { recordId: randomUUID(), recordVersion: 1 } },
    { sessionId, message: "hi", metadata: { projectId: randomUUID() } },
  ]) assert.equal((await request(app, "owner", input)).status, 400);
});

test("Stream enforces Session ownership and not-found before acquire", async () => {
  const { app } = route();
  assert.equal((await request(app, "intruder", { sessionId, message: "hi" })).status, 403);
  assert.equal((await request(app, "owner", { sessionId: randomUUID(), message: "hi" })).status, 404);
});


test("Stream has a ten-minute round timeout independent of model request timeout", () => {
  assert.equal(AGENT_STREAM_TIMEOUT_MS,600_000);
});


test("finalizing is progress only; done follows durable completion and reservation release", async () => {
  let finish!: () => void;
  const persisted = new Promise<void>(resolve => { finish = resolve; });
  const fixture = route(persisted);
  const response = await request(fixture.app, "owner", { sessionId, message: "hi" });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (!text.includes("event: finalizing")) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      text += decoder.decode(chunk.value);
    }
    assert.equal(fixture.released(), false);
    assert.equal(text.includes("event: done"), false);
    finish();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    assert.equal(fixture.released(), true);
    assert.match(text, /event: done/);
  } finally { finish(); await reader.cancel(); }
});
