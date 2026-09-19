import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import test from "node:test";
import { MemoryService } from "../../domain/memory/memory-service.js";
import { nowIso } from "../time.js";
import { createDatabase, runMigrations } from "../database/database.js";
import { rebuildMemoryIndex } from "./rebuild-memory-index.js";
import { SqliteVecMemoryIndex } from "./sqlite-vec-memory-index.js";

const vector = (x: number, y: number) => [x, y, ...Array.from({ length: 766 }, () => 0)];

const document = (userId: string, sourceId: string, content: string) => ({
  userId,
  sourceType: "record_text" as const,
  sourceId,
  recordId: sourceId,
  mediaId: null,
  content,
  contentHash: `hash-${userId}-${sourceId}-${content}`,
});

test("sqlite memory index searches only within the user partition", async () => {
  const path = `/tmp/fanto-memory-index-${randomUUID()}.sqlite`;
  const db = createDatabase(path); await runMigrations(db);
  try {
    const index = new SqliteVecMemoryIndex(db);
    await index.replace(document("u1", "a", "u1 exact"), vector(1, 0));
    await index.replace(document("u2", "c", "u2 closer"), vector(1, 0.01));
    await index.replace(document("u1", "b", "u1 second"), vector(0.9, 0.1));

    const hits = await index.search({ userId: "u1", sourceTypes: ["record_text", "image", "audio"], embedding: vector(1, 0), limit: 10 });
    assert.deepEqual(hits.map(hit => hit.sourceId), ["a", "b"]);
    assert.equal(hits.every(hit => hit.userId === "u1"), true);
    assert.equal(hits.some(hit => hit.sourceId === "c"), false);
  } finally {
    await db.destroy();
    await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true });
  }
});

test("sqlite memory index replaces, detects current hash, and removes derived data", async () => {
  const path = `/tmp/fanto-memory-replace-${randomUUID()}.sqlite`;
  const db = createDatabase(path); await runMigrations(db);
  try {
    const index = new SqliteVecMemoryIndex(db);
    const first = document("u1", "r1", "first");
    await index.replace(first, vector(1, 0));
    assert.equal(await index.isCurrent(first, first.contentHash), true);

    const second = document("u1", "r1", "second");
    await index.replace(second, vector(0, 1));
    assert.equal(await index.isCurrent(first, first.contentHash), false);
    assert.equal(await index.isCurrent(second, second.contentHash), true);
    assert.equal((await db.selectFrom("vector_items").selectAll().where("user_id", "=", "u1").execute()).length, 1);

    await index.remove(second);
    assert.equal((await db.selectFrom("vector_items").selectAll().where("user_id", "=", "u1").execute()).length, 0);
    assert.deepEqual(await index.search({ userId: "u1", sourceTypes: ["record_text", "image", "audio"], embedding: vector(0, 1), limit: 10 }), []);
  } finally {
    await db.destroy();
    await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true });
  }
});

test("memory rebuild resets derived index and rebuilds processed Records for all users", async () => {
  const path = `/tmp/fanto-memory-rebuild-${randomUUID()}.sqlite`;
  const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso();
    await db.insertInto("users").values([
      { user_id: "u1", wx_openid: "u1", created_at: now },
      { user_id: "u2", wx_openid: "u2", created_at: now },
    ]).execute();
    await db.insertInto("records").values([
      { record_id: "r1", user_id: "u1", source: "home", content: JSON.stringify({ text: "alpha", blocks: [] }), version: 1, status: "processed", task_id: null, event_at: now, created_at: now, updated_at: now },
      { record_id: "r2", user_id: "u2", source: "home", content: JSON.stringify({ text: "beta", blocks: [] }), version: 1, status: "processed", task_id: null, event_at: now, created_at: now, updated_at: now },
      { record_id: "pending", user_id: "u2", source: "home", content: JSON.stringify({ text: "not ready", blocks: [] }), version: 1, status: "pending", task_id: null, event_at: now, created_at: now, updated_at: now },
    ]).execute();

    const index = new SqliteVecMemoryIndex(db);
    await index.replace(document("u1", "stale", "stale"), vector(0.5, 0.5));

    const embeddings = {
      embed: async (text: string) => text.includes("alpha") ? vector(1, 0) : vector(0, 1),
    };
    const memory = new MemoryService(index, embeddings);
    const stats = await rebuildMemoryIndex(db, index, memory, { batchSize: 1 });

    assert.deepEqual(stats, { records: 2, users: 2 });
    assert.equal((await db.selectFrom("vector_items").selectAll().execute()).length, 2);
    assert.deepEqual((await memory.searchRecords({ userId: "u1", query: "alpha", limit: 5 })).map(item => item.sourceId), ["r1"]);
    assert.deepEqual((await memory.searchRecords({ userId: "u2", query: "beta", limit: 5 })).map(item => item.sourceId), ["r2"]);
  } finally {
    await db.destroy();
    await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true });
  }
});
