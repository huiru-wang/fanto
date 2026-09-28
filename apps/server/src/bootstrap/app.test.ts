import assert from "node:assert/strict";
import test from "node:test";
import { createApp, logSafeBody } from "./app.js";

test("protected API requires a verified access token", async () => {
  const auth = {
    verifyAccess: async (token: string) => ({ userId: "550e8400-e29b-41d4-a716-446655440000", tokenId: token }),
    assertActiveUser: async () => ({ status: "active" }),
  };
  const app = createApp({ records: {} as never, media: {} as never, auth: auth as never });

  const denied = await app.request("/api/not-found", {
    headers: { "x-user-id": "forged-user" },
  });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json() as { errorCode: string }).errorCode, "UNAUTHENTICATED");

  const allowed = await app.request("/api/not-found", {
    headers: { Authorization: "Bearer signed-access-token", "x-user-id": "forged-user" },
  });
  assert.equal(allowed.status, 404);
});


test("preference access logging redacts preference content and source quotes", () => {
  assert.deepEqual(logSafeBody("/api/preferences", {
    content: "技术方案详细展开",
    source: { sessionId: "s1", messageId: "m1", quote: "以后技术方案详细一点" },
    result: { sourceQuote: "以后技术方案详细一点", category: "communication" },
  }), {
    content: "[REDACTED]",
    source: { sessionId: "s1", messageId: "m1", quote: "[REDACTED]" },
    result: { sourceQuote: "[REDACTED]", category: "communication" },
  });
  assert.deepEqual(logSafeBody("/api/records", { content: "普通记录" }), { content: "普通记录" });
  assert.equal(
    logSafeBody("/api/media/550e8400-e29b-41d4-a716-446655440000/url", { url: "https://oss.example?signature=secret" }),
    "[REDACTED]",
  );
});
