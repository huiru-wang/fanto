import assert from "node:assert/strict";
import test from "node:test";
import { RecordPostprocessQueue } from "../infrastructure/queue/record-postprocess-queue.js";
import { createApp } from "./app.js";

test("runtime user allowlist only permits default-user", async () => {
  const app = createApp(
    {} as never,
    {} as never,
    new RecordPostprocessQueue(),
    {} as never,
    undefined,
    undefined,
    undefined,
    new Set(["default-user"]),
  );

  const denied = await app.request("/api/not-found", {
    headers: { "x-user-id": "other-user" },
  });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), {
    success: false,
    errorCode: "UNAUTHORIZED",
    errorMsg: "Unauthorized",
  });

  const allowed = await app.request("/api/not-found", {
    headers: { "x-user-id": "default-user" },
  });
  assert.equal(allowed.status, 404);
});
