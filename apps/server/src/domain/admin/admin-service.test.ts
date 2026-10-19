import assert from "node:assert/strict";
import test from "node:test";
import { AdminService, AdminNotFound, AdminInvalidCursor } from "./admin-service.js";
import { EMPTY_USAGE, usageFromAggregate, type AdminRepository } from "./admin-repository.js";

test("usage aggregation maps all Pi Usage fields, including zero and adjustments", () => {
  assert.deepEqual(usageFromAggregate(), EMPTY_USAGE);
  assert.deepEqual(usageFromAggregate({ input: "1", output: "2", cache_read: "3", cache_write: "4", total_tokens: "10", estimated_cost: "0.0025" }),
    { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, estimatedCost: 0.0025 });
});
test("admin paginates scoped users and sessions and returns empty usage where missing", async () => {
  const store = {
    listUsers: async () => ({ data: [{ userId: "bob", createdAt: "2026-10-19T00:00:00.000Z", nickname: "Bob", status: "active", lastLoginAt: null, providers: [] }], hasMore: true }),
    usageForUsers: async () => new Map(),
    getUser: async (id: string) => id === "bob" ? { userId: "bob" } : undefined,
    listSessions: async () => ({ data: [{ sessionId: "s1", userId: "bob", agentId: "main", title: "x", createdAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-19T01:00:00.000Z" }], hasMore: true }),
    usageForSessions: async () => new Map(),
  } as unknown as AdminRepository;
  const service = new AdminService(store);
  const users = await service.users({ limit: 20 });
  assert.equal(users.data[0]?.usage.totalTokens, 0);
  assert.ok(users.nextCursor);
  const next = await service.users({ limit: 20, cursor: users.nextCursor! });
  assert.equal(next.data.length, 1);
  const sessions = await service.sessions("bob", { limit: 20 });
  assert.equal(sessions.data[0]?.usage.totalTokens, 0);
  assert.ok(sessions.nextCursor);
  await service.sessions("bob", { limit: 20, cursor: sessions.nextCursor! });
  await assert.rejects(service.sessions("missing", { limit: 20 }), AdminNotFound);
  await assert.rejects(service.users({ limit: 20, cursor: "not-json" }), AdminInvalidCursor);
});
