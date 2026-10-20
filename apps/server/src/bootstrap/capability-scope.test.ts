import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";

test("authenticated requests cannot access retired business or background subscription routes", async () => {
  const app = createApp({ records: {} as never, media: {} as never, auth: {
    verifyAccess: async () => ({ userId: "owner" }), assertActiveUser: async () => ({}),
  } as never });
  for (const [method, path] of [
    ["GET", "/api/projects"], ["GET", "/api/proposals"],
    ["POST", "/api/proposals/old/accept"], ["PATCH", "/api/projects/old"],
    ["GET", "/api/agent/sessions/old/events"],
  ]) {
    const response = await app.request(path!, { method, headers: { Authorization: "Bearer test-only" } });
    assert.equal(response.status, 404, `${method} ${path}`);
  }
});
