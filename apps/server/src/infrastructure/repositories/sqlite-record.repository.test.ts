import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import test from "node:test";
import { createDatabase, runMigrations } from "../database.js";
import { SqliteRecordRepository } from "./sqlite-record.repository.js";
import { SqliteMediaRepository } from "./sqlite-media.repository.js";
import { nowIso } from "../time.js";
import { LocalMediaQueue } from "../local-media-queue.js";
import { registerImageUnderstandingListener } from "../../listeners/image-understanding.listener.js";

test("record save links ready media and rejects stale versions", async () => {
  const path = `/tmp/fanto-record-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    await db.insertInto("users").values({ id: "u", wx_openid: "u", created_at: nowIso() }).execute();
    const mediaId = randomUUID(); const now = nowIso();
    await db.insertInto("media_assets").values({ id: mediaId, user_id: "u", object_key: "private/audio", media_type: "audio", mime_type: "audio/mp4", bytes: 3, ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const created = await records.create({ userId: "u", value: { text: "memo", media: [{ mediaId }] } });
    assert.notEqual(typeof created, "string"); if (typeof created === "string") return;
    assert.equal(created.version, 1); assert.equal(created.content.blocks[0].mediaId, mediaId);
    const stale = await records.updateContent(created.id, "u", { value: { text: "new", media: [{ mediaId }] }, expectedVersion: 2 });
    assert.equal(stale, "conflict");
    const updated = await records.updateContent(created.id, "u", { value: { text: "new", media: [{ mediaId }] }, expectedVersion: 1 });
    assert.notEqual(typeof updated, "string"); if (typeof updated !== "string") assert.equal(updated.version, 2);
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("image listener writes only the current record version", async () => {
  const path = `/tmp/fanto-image-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); const mediaId = randomUUID(); await db.insertInto("users").values({ id: "u", wx_openid: "u", created_at: now }).execute();
    await db.insertInto("media_assets").values({ id: mediaId, user_id: "u", object_key: "private/image", media_type: "image", mime_type: "image/png", bytes: 3, ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const media = new SqliteMediaRepository(db); const created = await records.create({ userId: "u", value: { text: "", media: [{ mediaId }] } });
    assert.notEqual(typeof created, "string"); if (typeof created === "string") return;
    const queue = new LocalMediaQueue(); registerImageUnderstandingListener(queue, records, media, { readUrl: () => "https://private.example/image" } as any, { describe: async () => ({ description: "一棵树。" }) });
    queue.publish("image_understanding", { recordId: created.id, userId: "u", mediaId, version: created.version }); await new Promise(resolve => setImmediate(resolve));
    const described = await records.findById(created.id); assert.equal((described?.content.blocks[0] as { description?: string }).description, "一棵树。");
    const updated = await records.updateContent(created.id, "u", { value: { text: "updated", media: [{ mediaId }] }, expectedVersion: 1 }); assert.notEqual(typeof updated, "string");
    queue.publish("image_understanding", { recordId: created.id, userId: "u", mediaId, version: 1 }); await new Promise(resolve => setImmediate(resolve));
    const current = await records.findById(created.id); assert.equal(current?.version, 2); assert.equal((current?.content.blocks[0] as { description?: string }).description, undefined);
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});
