import test from "node:test";
import assert from "node:assert/strict";
import { createAdminRoutes } from "./admin.js";
import { createApp, logSafeBody } from "../bootstrap/app.js";
import type { RecordService } from "../domain/records/index.js";
import type { MediaService } from "../domain/media/index.js";
import { AdminInvalidCursor, AdminNotFound, type AdminService } from "../domain/admin/index.js";

const KEY = "0a".repeat(32);
const calls: string[] = [];
const admin = {
  users: async () => { calls.push("users"); return { data: [], hasMore: false, nextCursor: null }; },
  user: async (id: string) => { if (id === "missing") throw new AdminNotFound("User not found"); return { userId: id }; },
  userUsage: async (id: string) => ({ userId: id, sessionCount: 0, usage: { totalTokens: 0 } }),
  sessions: async (_id: string, args: { cursor?: string }) => { if (args.cursor) throw new AdminInvalidCursor("Invalid pagination cursor"); return { data: [], hasMore: false, nextCursor: null }; },
  sessionUsage: async (id: string) => ({ session: { sessionId: id }, models: [] }),
} as unknown as AdminService;

const api = createAdminRoutes(admin, KEY);
const requestWithKey = (key: string | undefined, path: string, init?: RequestInit) => api.request(path, {
  ...init, headers: { ...init?.headers, ...(key === undefined ? {} : { "X-Admin-Key": key }) },
});

test("all admin endpoints deny missing, wrong, and short keys before data access", async () => {
  calls.length = 0;
  for (const path of ["/users", "/users/another", "/users/another/usage", "/users/another/sessions", "/sessions/foreign/usage"]) {
    for (const key of [undefined, "invalid", "f".repeat(64)]) {
      const response = await requestWithKey(key, path);
      assert.equal(response.status, 401, path);
      assert.equal((await response.json() as { errorCode: string }).errorCode, "UNAUTHENTICATED");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  assert.deepEqual(calls, []);
});

test("admin key grants all five read routes without an authenticated user principal", async () => {
  for (const path of ["/users", "/users/another", "/users/another/usage", "/users/another/sessions", "/sessions/a/usage"]) {
    const response = await requestWithKey(KEY, path);
    assert.equal(response.status, 200, path);
    assert.equal((await response.json() as { success: boolean }).success, true);
  }
  assert.equal((await requestWithKey(KEY, "/users?limit=101")).status, 400);
  assert.equal((await requestWithKey(KEY, "/users/another/sessions?limit=-1")).status, 400);
  assert.equal((await requestWithKey(KEY, "/users/missing")).status, 404);
  assert.equal((await requestWithKey(KEY, "/users/another/sessions?cursor=invalid")).status, 400);
});

test("admin routes reject all access if key is unconfigured or too short", async () => {
  for (const configured of [undefined, "", "not-strong-enough"]) {
    const app = createAdminRoutes(admin, configured);
    for (const attempt of [undefined, configured, KEY]) {
      const response = await app.request("/users", { headers: attempt === undefined ? {} : { "X-Admin-Key": attempt } });
      assert.equal(response.status, 401);
    }
  }
});

test("main app bypasses user JWT only for admin paths; admin key does not open user routes", async () => {
  const app = createApp({ records: {} as RecordService, media: {} as MediaService, admin, adminAccessKey: KEY });
  const headers = { "X-Admin-Key": KEY };
  assert.equal((await app.request("/api/admin/users", { headers })).status, 200);
  assert.equal((await app.request("/api/admin/users", { headers: { Authorization: `Bearer ${KEY}` } })).status, 401);
  assert.equal((await app.request("/api/records", { headers })).status, 401);
  assert.equal((await app.request("/api/administrator", { headers })).status, 401);
  assert.equal(logSafeBody("/api/admin/users", { key: KEY, data: [1] }), "[REDACTED]");
});
