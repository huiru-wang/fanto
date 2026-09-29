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


test("media URL route validates and forwards the requested variant", async () => {
  const variants: string[] = [];
  const auth = {
    verifyAccess: async () => ({ userId: "user-1", tokenId: "token" }),
    assertActiveUser: async () => ({ user_id: "user-1", status: "active" }),
  };
  const media = {
    readUrl: async (_userId: string, _mediaId: string, variant: string) => {
      variants.push(variant);
      return { url: "https://oss.example/file", expiresAt: "2026-09-29T00:05:00.000Z" };
    },
  };
  const app = createApp({ records: {} as never, media: media as never, auth: auth as never });

  const thumbnail = await app.request("/api/media/media-1/url?variant=thumbnail", {
    headers: { Authorization: "Bearer token" },
  });
  assert.equal(thumbnail.status, 200);
  assert.deepEqual(variants, ["thumbnail"]);

  const invalid = await app.request("/api/media/media-1/url?variant=large", {
    headers: { Authorization: "Bearer token" },
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json() as { errorCode: string }).errorCode, "INVALID_INPUT");
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
