import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("runtime identity comes only from verified access token", async () => {
  const verifier = {
    verify: async (token: string) => {
      if (token !== "valid-token") throw new Error("invalid token");
      return { userId: "550e8400-e29b-41d4-a716-446655440000" };
    },
  };
  const app = createApp(
    verifier,
    {} as never,
    {} as never,
  );

  const denied = await app.request(new Request("http://localhost/api/agent/unknown", {
    headers: { Authorization: "Bearer invalid-token", "X-User-Id": "forged-user" },
  }));
  assert.equal(denied.status, 401);

  const allowed = await app.request(new Request("http://localhost/api/agent/unknown", {
    headers: { Authorization: "Bearer valid-token", "X-User-Id": "forged-user" },
  }));
  assert.equal(allowed.status, 404);
});
