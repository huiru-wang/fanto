import assert from "node:assert/strict";
import test from "node:test";
import { TtlCache } from "../../infrastructure/cache/ttl-cache.js";
import type { UserPreference } from "./model.js";
import type { PreferenceRepository } from "./repository.js";
import { PreferenceService } from "./preference-service.js";

function preference(id: string, version = 1): UserPreference {
  return {
    preferenceId: id,
    userId: "user-1",
    category: "communication",
    content: `content-${id}`,
    sourceSessionId: "session-1",
    sourceMessageId: "message-1",
    sourceQuote: "quote",
    version,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
}

function createRepository(rows: UserPreference[]) {
  let listCalls = 0;
  const repo: PreferenceRepository = {
    async listByUser(_userId, limit) {
      listCalls += 1;
      return rows.slice(0, limit);
    },
    async findById(_userId, preferenceId) {
      return rows.find(item => item.preferenceId === preferenceId);
    },
    async findSame() {
      return undefined;
    },
    async create() {
      return preference("created");
    },
    async update(input) {
      return { kind: "ok", preference: preference(input.preferenceId, input.expectedVersion + 1) };
    },
    async delete(input) {
      return { kind: "ok", preference: preference(input.preferenceId, input.expectedVersion) };
    },
  };
  return { repo, getListCalls: () => listCalls };
}

test("PreferenceService caches the first 20 preferences per user", async () => {
  const rows = Array.from({ length: 20 }, (_, index) => preference(`p-${index}`));
  const { repo, getListCalls } = createRepository(rows);
  const cache = new TtlCache<string, UserPreference[]>({ ttlMs: 30_000, maxEntries: 10 });
  const service = new PreferenceService(repo, cache);

  const first = await service.list("user-1");
  const second = await service.list("user-1");

  assert.equal(first.length, 20);
  assert.equal(second.length, 20);
  assert.equal(getListCalls(), 1);
});

test("PreferenceService invalidates cached preferences after create, update, and delete", async () => {
  const rows = [preference("p-1"), preference("p-2")];
  const { repo, getListCalls } = createRepository(rows);
  const cache = new TtlCache<string, UserPreference[]>({ ttlMs: 30_000, maxEntries: 10 });
  const service = new PreferenceService(repo, cache);
  const source = { sessionId: "session-1", messageId: "message-1", quote: "quote" };

  await service.list("user-1");
  assert.equal(getListCalls(), 1);

  await service.create({
    userId: "user-1",
    category: "communication",
    content: "new preference",
    source,
  });
  await service.list("user-1");
  assert.equal(getListCalls(), 2);

  await service.update({
    userId: "user-1",
    preferenceId: "p-1",
    expectedVersion: 1,
    category: "communication",
    content: "updated preference",
    source,
  });
  await service.list("user-1");
  assert.equal(getListCalls(), 3);

  await service.delete({ userId: "user-1", preferenceId: "p-1", expectedVersion: 1 });
  await service.list("user-1");
  assert.equal(getListCalls(), 4);
});

test("PreferenceService uses cached count when enforcing the 20 preference limit", async () => {
  const rows = Array.from({ length: 20 }, (_, index) => preference(`p-${index}`));
  const { repo, getListCalls } = createRepository(rows);
  const cache = new TtlCache<string, UserPreference[]>({ ttlMs: 30_000, maxEntries: 10 });
  const service = new PreferenceService(repo, cache);

  await service.list("user-1");
  const result = await service.create({
    userId: "user-1",
    category: "scenario",
    content: "one too many",
    source: { sessionId: "session-1", messageId: "message-1", quote: "quote" },
  });

  assert.equal(result.kind, "limit_reached");
  assert.equal(getListCalls(), 1);
});
