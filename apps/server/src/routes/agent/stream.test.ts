import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAgentRoutes, AGENT_STREAM_TIMEOUT_MS } from "./stream.js";
import { runWithRequestPrincipal } from "../request-user.js";
import { SessionNotFoundError, SessionOwnershipError } from "../../agent/harness/session-manager.js";
import { createRunContext } from "../../agent/context/run-context.js";

const sessionId = randomUUID();
const projectId = randomUUID();

function route() {
  let observed: ReturnType<typeof createRunContext.read> | undefined;
  const session = {
    id: sessionId, userId: "owner", agentId: "creator-agent",
    runtime: {
      readRecentMessages: async () => [],
      harness: { events: { on: () => () => {} } },
      tools: [], abort: async () => {},
      prompt: async (_: string, context: Parameters<typeof createRunContext.read>[0]) => {
        observed = createRunContext.read(context);
        return { ok: true, value: { status: "completed" } };
      },
    },
  };
  const sessions = {
    resolveAgentId: async (id: string, userId: string) => {
      if (id !== sessionId) throw new SessionNotFoundError();
      if (userId !== "owner") throw new SessionOwnershipError();
      return "creator-agent";
    },
    acquire: async (definition: { id: string }) => { assert.equal(definition.id, "creator-agent"); return session; },
    reserve: () => () => {},
  };
  const registry = { get: (id: string) => id === "creator-agent" ? { id, revision: "v1" } : undefined };
  return { app: createAgentRoutes(registry as never, sessions as never), observed: () => observed };
}

const request = (app: ReturnType<typeof createAgentRoutes>, userId: string, body: unknown) => runWithRequestPrincipal(
  { userId, source: "user" },
  () => app.request("/stream", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }),
);

test("Stream resolves agent identity from owned Session, and forwards only project metadata", async () => {
  const { app, observed } = route();
  const response = await request(app, "owner", { sessionId, message: "继续", metadata: { projectId } });
  assert.equal(response.status, 200);
  const payload = await response.text();
  assert.match(payload, /event: done/);
  assert.equal(observed()?.projectId, projectId);
  assert.equal(observed()?.recordId, undefined);
});

test("Stream rejects client agentId, record authorities and invalid projectId", async () => {
  const { app } = route();
  for (const input of [
    { sessionId, message: "hi", agentId: "main" },
    { sessionId, message: "hi", metadata: { recordId: randomUUID(), recordVersion: 1 } },
    { sessionId, message: "hi", metadata: { projectId: "bad" } },
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
