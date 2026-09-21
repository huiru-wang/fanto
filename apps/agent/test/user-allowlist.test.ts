import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("runtime user allowlist only permits default-user", async () => {
  const app = createApp(
    "test-token",
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    new Set(["default-user"]),
  );

  const denied = await app.request(new Request("http://localhost/api/agent/unknown", {
    headers: {
      Authorization: "Bearer test-token",
      "X-User-Id": "other-user",
    },
  }));
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: "Unauthorized" });

  const allowed = await app.request(new Request("http://localhost/api/agent/unknown", {
    headers: {
      Authorization: "Bearer test-token",
      "X-User-Id": "default-user",
    },
  }));
  assert.equal(allowed.status, 404);
});
