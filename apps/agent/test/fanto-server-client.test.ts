import assert from "node:assert/strict";
import test from "node:test";
import { FantoServerClient, FantoServerClientError } from "../src/clients/fanto-server-client.js";

const record = {
  id: "r1",
  userId: "u1",
  source: "home",
  content: { text: "hello", blocks: [] },
  version: 1,
  status: "processed",
  eventAt: "2026-09-18T00:00:00.000Z",
  createdAt: "2026-09-18T00:00:00.000Z",
  updatedAt: "2026-09-18T00:00:00.000Z",
  media: [{ url: "/api/media/m1" }],
};

const ok = (result: unknown, status = 200) => new Response(JSON.stringify({
  success: true,
  result,
  errorCode: null,
  errorMsg: null,
}), { status, headers: { "content-type": "application/json" } });

test("sends user and trace headers and maps all Record endpoints", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const url = String(input);
    if (url.includes("/search")) return ok({ data: [{ recordId: "r1", sourceType: "image", mediaId: "m1", snippet: "hit", distance: 0.12 }] });
    if (url.includes("?")) return ok({ data: [record], hasMore: true, nextCursor: "next", pageSize: 2 });
    return ok(record);
  }) as typeof fetch;
  const client = new FantoServerClient("http://server.local:3000", 1_000, fetchImpl);
  const ctx = { userId: "u1", traceId: "trace-1" };

  assert.equal((await client.getRecord(ctx, "r/1")).id, "r1");
  assert.equal((await client.listRecords(ctx, { limit: 2, cursor: "c+d" })).nextCursor, "next");
  assert.deepEqual((await client.searchRecords(ctx, { query: "AI Coding", limit: 3 })).data, [{ recordId: "r1", sourceType: "image", mediaId: "m1", snippet: "hit", distance: 0.12 }]);

  assert.match(calls[0]?.url ?? "", /\/api\/records\/r%2F1$/);
  assert.match(calls[1]?.url ?? "", /limit=2/);
  assert.match(calls[1]?.url ?? "", /cursor=c%2Bd/);
  assert.equal(new Headers(calls[0]?.init?.headers).get("x-user-id"), "u1");
  assert.equal(new Headers(calls[0]?.init?.headers).get("x-trace-id"), "trace-1");
  assert.equal(calls[2]?.init?.method, "POST");
  assert.equal(calls[2]?.init?.body, JSON.stringify({ query: "AI Coding", limit: 3 }));
  assert.equal(new Headers(calls[2]?.init?.headers).get("content-type"), "application/json");
});

test("omits trace header when no trace id exists", async () => {
  let headers = new Headers();
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    headers = new Headers(init?.headers);
    return ok(record);
  }) as typeof fetch;
  await new FantoServerClient("http://server.local", 1_000, fetchImpl).getRecord({ userId: "u1" }, "r1");
  assert.equal(headers.get("x-user-id"), "u1");
  assert.equal(headers.has("x-trace-id"), false);
});

test("rejects invalid base URLs at startup", () => {
  assert.throws(() => new FantoServerClient("not a url"), /valid URL/);
  assert.throws(() => new FantoServerClient("file:///tmp/fanto"), /http or https/);
});

test("maps HTTP failures without leaking raw payloads", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({
    success: false,
    errorCode: "NOT_FOUND",
    errorMsg: "internal record details",
  }), { status: 404, headers: { "content-type": "application/json" } })) as typeof fetch;
  const client = new FantoServerClient("http://server.local", 1_000, fetchImpl);
  await assert.rejects(
    () => client.getRecord({ userId: "u1" }, "missing"),
    (error: unknown) => error instanceof FantoServerClientError
      && error.kind === "http"
      && error.status === 404
      && error.errorCode === "NOT_FOUND"
      && error.message === "Record not found or not accessible",
  );
});

test("maps success=false and 5xx envelopes to HTTP errors", async () => {
  const successFalse = new FantoServerClient("http://server.local", 1_000, (async () => ok(null)) as typeof fetch);
  const fetchFalse = (async () => new Response(JSON.stringify({ success: false, errorCode: "BROKEN", errorMsg: "failed" }), { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => new FantoServerClient("http://server.local", 1_000, fetchFalse).getRecord({ userId: "u1" }, "r1"),
    (error: unknown) => error instanceof FantoServerClientError && error.kind === "http" && error.errorCode === "BROKEN",
  );
  void successFalse;

  const fetch500 = (async () => new Response(JSON.stringify({ success: false, errorCode: "INTERNAL_ERROR", errorMsg: "bad" }), { status: 500 })) as typeof fetch;
  await assert.rejects(
    () => new FantoServerClient("http://server.local", 1_000, fetch500).getRecord({ userId: "u1" }, "r1"),
    (error: unknown) => error instanceof FantoServerClientError && error.kind === "http" && error.status === 500,
  );
});

test("rejects malformed JSON and invalid successful DTOs as protocol errors", async () => {
  const invalidJson = (async () => new Response("{", { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => new FantoServerClient("http://server.local", 1_000, invalidJson).getRecord({ userId: "u1" }, "r1"),
    (error: unknown) => error instanceof FantoServerClientError && error.kind === "protocol",
  );

  const invalidDto = (async () => ok({ id: "missing-fields" })) as typeof fetch;
  await assert.rejects(
    () => new FantoServerClient("http://server.local", 1_000, invalidDto).getRecord({ userId: "u1" }, "r1"),
    (error: unknown) => error instanceof FantoServerClientError && error.kind === "protocol",
  );
});

test("maps network failures", async () => {
  const fetchImpl = (async () => { throw new Error("ECONNREFUSED secret-internal-host"); }) as typeof fetch;
  await assert.rejects(
    () => new FantoServerClient("http://server.local", 1_000, fetchImpl).getRecord({ userId: "u1" }, "r1"),
    (error: unknown) => error instanceof FantoServerClientError
      && error.kind === "network"
      && error.message === "Fanto Server is temporarily unavailable",
  );
});

test("times out stalled Business Server requests", async () => {
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  await assert.rejects(
    () => new FantoServerClient("http://server.local", 5, fetchImpl).getRecord({ userId: "u1" }, "r1"),
    (error: unknown) => error instanceof FantoServerClientError && error.kind === "timeout",
  );
});

test("propagates caller cancellation instead of converting it to a network error", async () => {
  const controller = new AbortController();
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  const request = new FantoServerClient("http://server.local", 1_000, fetchImpl).getRecord({
    userId: "u1",
    signal: controller.signal,
  }, "r1");
  controller.abort(new Error("cancelled by agent run"));
  await assert.rejects(() => request, /cancelled by agent run/);
});
