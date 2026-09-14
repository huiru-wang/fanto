import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/bootstrap/app.js";
import { SessionAgentMismatchError } from "../src/harness/session-manager.js";

const definition = {
  id: "coding", description: "", provider: "deepseek", model: "deepseek-v4-pro", systemPrompt: "test",
  tools: [], skills: [], compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 },
};
const request = (url: string, body?: unknown) => new Request(`http://localhost${url}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test("selects an agent and returns its generated session id in SSE", async () => {
  const calls: string[] = [];
  const sessions = {
    acquire: async () => ({ id: "8c52e2fc-1741-42b3-8973-cfae75ff3f63", agentId: "coding" }),
    reserve: () => () => {},
    prompt: async (_session: unknown, message: string, _signal: AbortSignal, emit: (delta: string) => Promise<void>) => {
      calls.push(message);
      await emit("你好");
    },
    entries: async () => ({ agentId: "coding", entries: [] }),
  };
  const app = createApp("test-token", { get: (id: string) => id === "coding" ? definition : undefined } as never, sessions as never);
  const response = await app.request(request("/api/agent", { agentId: "coding", message: "hello" }));
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /event: start/);
  assert.match(text, /"sessionId":"8c52e2fc-1741-42b3-8973-cfae75ff3f63"/);
  assert.match(text, /event: done/);
  assert.deepEqual(calls, ["hello"]);
});

test("rejects an unknown agent and a session bound to another agent", async () => {
  const sessions = { acquire: async () => { throw new SessionAgentMismatchError(); }, reserve: () => () => {}, prompt: async () => {}, entries: async () => ({ agentId: "coding", entries: [] }) };
  const app = createApp("test-token", { get: (id: string) => id === "coding" ? definition : undefined } as never, sessions as never);
  assert.equal((await app.request(request("/api/agent", { agentId: "missing", message: "hello" }))).status, 404);
  assert.equal((await app.request(request("/api/agent", { agentId: "coding", sessionId: "8c52e2fc-1741-42b3-8973-cfae75ff3f63", message: "hello" }))).status, 409);
});

test("reads paginated session records and omits internal configuration entries", async () => {
  const sessions = {
    acquire: async () => ({ id: "", agentId: "coding" }), reserve: () => () => {}, prompt: async () => {},
    entries: async () => ({ agentId: "coding", entries: [
      { type: "custom", customType: "fanto.agent_config", data: { agentId: "coding" }, id: "a", parentId: null, seq: 1, timestamp: 1 },
      { type: "message", message: { role: "user", content: "hello", timestamp: 1 }, id: "b", parentId: "a", seq: 2, timestamp: 2 },
    ] }),
  };
  const app = createApp("test-token", { get: () => definition } as never, sessions as never);
  const response = await app.request(request("/api/sessions/8c52e2fc-1741-42b3-8973-cfae75ff3f63/messages?limit=1"));
  const payload = await response.json() as { result: { agentId: string; data: Array<{ seq: number }> } };
  assert.equal(response.status, 200);
  assert.equal(payload.result.agentId, "coding");
  assert.deepEqual(payload.result.data.map(entry => entry.seq), [2]);
});
