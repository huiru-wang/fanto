import test from "node:test";
import assert from "node:assert/strict";
import { createAdminRoutes } from "./admin.js";
import { runWithRequestPrincipal } from "./request-user.js";
import { AdminInvalidCursor, AdminNotFound, type AdminService } from "../domain/admin/index.js";

const calls: string[] = [];
const admin = {
  users: async () => { calls.push("users"); return { data: [], hasMore: false, nextCursor: null }; },
  user: async (id: string) => { if (id === "missing") throw new AdminNotFound("User not found"); return { userId: id }; },
  userUsage: async (id: string) => ({ userId: id, sessionCount: 0, usage: { totalTokens: 0 } }),
  sessions: async (_id: string, args: { cursor?: string }) => { if (args.cursor) throw new AdminInvalidCursor("Invalid pagination cursor"); return { data: [], hasMore: false, nextCursor: null }; },
  sessionUsage: async (id: string) => ({ session: { sessionId: id }, models: [] }),
} as unknown as AdminService;

const api = createAdminRoutes(admin, new Set(["user001"]));
const requestAs = (userId: string, path: string, init?: RequestInit) => runWithRequestPrincipal({ userId, source: "user" }, () => api.request(path, init));
test("admin routes deny all non-whitelisted users before querying data", async () => {
  calls.length = 0;
  for (const path of ["/users", "/users/another", "/users/another/usage", "/users/another/sessions", "/sessions/foreign/usage"]) {
    const response = await requestAs("ordinary-user", path);
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { errorCode: string }).errorCode, "FORBIDDEN");
  }
  assert.deepEqual(calls, []);
});
test("admin routes allow user001 and reject invalid parameters", async () => {
  for (const path of ["/users", "/users/another", "/users/another/usage", "/users/another/sessions", "/sessions/a/usage"]) {
    const response = await requestAs("user001", path);
    assert.equal(response.status, 200, path);
    assert.equal((await response.json() as { success: boolean }).success, true);
  }
  assert.equal((await requestAs("user001", "/users?limit=101")).status, 400);
  assert.equal((await requestAs("user001", "/users/another/sessions?limit=-1")).status, 400);
  assert.equal((await requestAs("user001", "/users/missing")).status, 404);
  assert.equal((await requestAs("user001", "/users/another/sessions?cursor=invalid")).status, 400);
});
