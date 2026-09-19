import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/bootstrap/app.js";

const sessionId = "8c52e2fc-1741-42b3-8973-cfae75ff3f63";
const taskId = "8c52e2fc-1741-42b3-8973-cfae75ff3f64";
const definition = {
  id: "coding", description: "", provider: "deepseek", model: "deepseek-v4-pro", systemPrompt: "test",
  tools: [], skills: [], compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 },
};
const request = (url: string, body?: unknown) => new Request(`http://localhost${url}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { Authorization: "Bearer test-token", "Content-Type": "application/json", "X-User-Id": "user_1", "X-Trace-Id": "trace_1" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const registry = { get: (id: string) => id === "coding" ? definition : undefined } as never;


test("allows browser CORS preflight for Agent APIs", async () => {
  const app = createApp("test-token", registry, {} as never, {} as never, {} as never);
  const response = await app.request(new Request("http://localhost/api/agent/stream", {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:8099",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,x-user-id",
    },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
  const headers = (response.headers.get("access-control-allow-headers") ?? "").toLowerCase();
  assert.match(headers, /authorization/);
  assert.match(headers, /content-type/);
  assert.match(headers, /x-user-id/);
});

test("creates a session before streaming and requires its id", async () => {
  const calls: string[] = [];
  const sessions = {
    create: async () => ({ id: sessionId, agentId: "coding" }),
    acquire: async () => ({ id: sessionId, agentId: "coding", userId: "user_1" }),
    reserve: () => () => {},
    prompt: async (_session: unknown, message: string, _signal: AbortSignal, _metadata: unknown, emit: (event: { type: string; [key: string]: unknown }) => Promise<void>) => {
      calls.push(message);
      await emit({ type: "turn_start" });
      await emit({ type: "tool_start", toolCallId: "call-1", toolName: "record_search", args: { query: "private" } });
      await emit({ type: "tool_end", toolCallId: "call-1", toolName: "record_search", status: "succeeded", result: { private: true } });
      await emit({ type: "delta", text: "你好" });
      return "你好";
    },
    history: async () => ({ agentId: "coding", entries: [], hasMore: false, nextCursor: null }),
  };
  const app = createApp("test-token", registry, sessions as never, { create: () => undefined, get: () => undefined } as never, { wake: () => {} } as never);
  const created = await app.request(request("/api/agent/sessions", { agentId: "coding" }));
  const payload = await created.json() as { result: { sessionId: string } };
  assert.equal(created.status, 201);
  assert.equal(payload.result.sessionId, sessionId);
  assert.equal((await app.request(request("/api/agent/stream", { agentId: "coding", message: "hello" }))).status, 400);
  const response = await app.request(request("/api/agent/stream", { agentId: "coding", sessionId, message: "hello" }));
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /event: start/);
  assert.match(text, new RegExp(`"sessionId":"${sessionId}"`));
  assert.match(text, /event: turn_start/);
  assert.match(text, /event: tool_start/);
  assert.match(text, /"toolCallId":"call-1","toolName":"record_search"/);
  assert.match(text, /event: tool_end/);
  assert.match(text, /"status":"succeeded"/);
  assert.match(text, /event: delta/);
  assert.match(text, /"text":"你好"/);
  assert.doesNotMatch(text, /private/);
  assert.match(text, /event: done/);
  assert.deepEqual(calls, ["hello"]);
});

test("rejects an unknown agent", async () => {
  const sessions = { create: async () => ({ id: sessionId, agentId: "coding" }), acquire: async () => ({ id: sessionId, agentId: "coding" }), reserve: () => () => {}, prompt: async () => "", history: async () => ({ agentId: "coding", entries: [], hasMore: false, nextCursor: null }) };
  const app = createApp("test-token", registry, sessions as never, {} as never, {} as never);
  assert.equal((await app.request(request("/api/agent/stream", { agentId: "missing", sessionId, message: "hello" }))).status, 404);
});

test("reads reverse history without compaction entries", async () => {
  const sessions = {
    create: async () => ({ id: sessionId, agentId: "coding" }), acquire: async () => ({ id: sessionId, agentId: "coding" }), reserve: () => () => {}, prompt: async () => "",
    history: async () => ({ agentId: "coding", entries: [{ type: "message", id: "b", parentId: null, seq: 8, timestamp: 2, message: { role: "user", content: "hello", timestamp: 2 } }], hasMore: true, nextCursor: 8 }),
  };
  const app = createApp("test-token", registry, sessions as never, {} as never, {} as never);
  const response = await app.request(request(`/api/agent/sessions/${sessionId}/history?limit=1`));
  const payload = await response.json() as { result: { data: Array<{ seq: number }>; hasMore: boolean; nextCursor: number } };
  assert.equal(response.status, 200);
  assert.deepEqual(payload.result.data.map(entry => entry.seq), [8]);
  assert.equal(payload.result.hasMore, true);
  assert.equal(payload.result.nextCursor, 8);
});

test("queues and reads an asynchronous task", async () => {
  const calls: string[] = [];
  const task = { id: taskId, sessionId, agentId: "coding", status: "pending", input: "hello", output: null, error: null, traceId: "trace_1", createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z" };
  const sessions = { create: async () => ({ id: sessionId, agentId: "coding" }), acquire: async () => ({ id: sessionId, agentId: "coding" }), assertOwnership: async () => {}, reserve: () => () => {}, prompt: async () => "", history: async () => ({ agentId: "coding", entries: [], hasMore: false, nextCursor: null }) };
  const tasks = { create: (input: { message: string }) => { calls.push(input.message); return task; }, get: (id: string) => id === taskId ? task : undefined };
  const runner = { wake: () => calls.push("wake") };
  const app = createApp("test-token", registry, sessions as never, tasks as never, runner as never);
  const created = await app.request(request("/api/agent/tasks", { agentId: "coding", sessionId, message: "hello" }));
  assert.equal(created.status, 202);
  assert.deepEqual(calls, ["hello", "wake"]);
  const result = await app.request(request(`/api/agent/tasks/${taskId}`));
  assert.equal(result.status, 200);
  assert.equal((await result.json() as { result: { id: string } }).result.id, taskId);
});
