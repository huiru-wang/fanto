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
import { createApp } from "../../server.js";
import { RecordMemoryService } from "../../application/memory/record-memory.js";

test("timestamps are stored in UTC ISO format", () => {
  assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T.*Z$/);
});

test("audio ASR is stored on media without changing Record text", async () => {
  const path = `/tmp/fanto-asr-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); const mediaId = randomUUID(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: "private/audio", media_type: "audio", mime_type: "audio/mp4", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const media = new SqliteMediaRepository(db); await media.updateAsr(mediaId, "u", { status: "succeeded", transcript: "语音转写", model: "qwen3-asr-flash", completedAt: now });
    const asset = await media.findMedia(mediaId, "u"); assert.deepEqual(asset?.extData.asr, { status: "succeeded", transcript: "语音转写", model: "qwen3-asr-flash", completedAt: now });
    const records = new SqliteRecordRepository(db); const record = await records.create({ userId: "u", value: { text: "手写文本", media: [{ mediaId }] } });
    assert.notEqual(typeof record, "string"); if (typeof record !== "string") assert.equal(record.content.text, "手写文本");
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record memory indexes text and ASR with record outerId", async () => {
  const path = `/tmp/fanto-vector-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ embedding: Array.from({ length: 1536 }, () => 0.1) }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const now = nowIso(); const mediaId = randomUUID(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: "private/audio", media_type: "audio", mime_type: "audio/mp4", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {}, asr: { transcript: "周末去西山徒步" } }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const record = await records.create({ userId: "u", value: { text: "准备雨衣", media: [{ mediaId }] } });
    assert.notEqual(typeof record, "string"); if (typeof record === "string") return;
    const memory = new RecordMemoryService(db, { embeddingApiKey: "test", embeddingApiBase: "https://embedding.test/v1", embeddingModel: "test", embeddingDimension: 1536 } as any);
    await memory.index({ userId: "u", recordId: record.id, operation: "upsert" });
    assert.deepEqual(await memory.search("u", "徒步", 5), [{ recordId: record.id, snippet: "用户记录：准备雨衣\n音频转写：周末去西山徒步", score: 0 }]);
    const updated = await records.updateContent(record.id, "u", { value: { text: "准备登山杖", media: [{ mediaId }] }, expectedVersion: 1 });
    assert.notEqual(typeof updated, "string"); await memory.index({ userId: "u", recordId: record.id, operation: "replace" });
    assert.deepEqual(await memory.search("u", "徒步", 5), [{ recordId: record.id, snippet: "用户记录：准备登山杖\n音频转写：周末去西山徒步", score: 0 }]);
    assert.deepEqual((await memory.getRecords("u", [record.id]))[0]?.media, [{ mediaId, type: "audio", asrTranscript: "周末去西山徒步" }]);
  } finally { globalThis.fetch = originalFetch; await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record save links ready media and rejects stale versions", async () => {
  const path = `/tmp/fanto-record-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: nowIso() }).execute();
    const mediaId = randomUUID(); const now = nowIso();
    await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: "private/audio", media_type: "audio", mime_type: "audio/mp4", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const created = await records.create({ userId: "u", value: { text: "memo", media: [{ mediaId }] } });
    assert.notEqual(typeof created, "string"); if (typeof created === "string") return;
    assert.equal(created.version, 1); assert.deepEqual(created.content.blocks[0], { type: "audio", mediaId });
    const stale = await records.updateContent(created.id, "u", { value: { text: "new", media: [{ mediaId }] }, expectedVersion: 2 });
    assert.equal(stale, "conflict");
    const updated = await records.updateContent(created.id, "u", { value: { text: "new", media: [{ mediaId }] }, expectedVersion: 1 });
    assert.notEqual(typeof updated, "string"); if (typeof updated !== "string") assert.equal(updated.version, 2);
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("image listener writes only the current record version", async () => {
  const path = `/tmp/fanto-image-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); const mediaId = randomUUID(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: "private/image", media_type: "image", mime_type: "image/png", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const media = new SqliteMediaRepository(db); const created = await records.create({ userId: "u", value: { text: "photo", media: [{ mediaId }] } });
    assert.notEqual(typeof created, "string"); if (typeof created === "string") return;
    const queue = new LocalMediaQueue(); registerImageUnderstandingListener(queue, records, media, { readUrl: () => "https://private.example/image" } as any, { describe: async () => ({ description: "一棵树。" }) });
    queue.publish("image_understanding", { recordId: created.id, userId: "u", mediaId, version: created.version }); await new Promise(resolve => setImmediate(resolve));
    const described = await records.findById(created.id); assert.equal((described?.content.blocks[0] as { description?: string }).description, "一棵树。");
    const updated = await records.updateContent(created.id, "u", { value: { text: "updated", media: [{ mediaId }] }, expectedVersion: 1 }); assert.notEqual(typeof updated, "string");
    queue.publish("image_understanding", { recordId: created.id, userId: "u", mediaId, version: 1 }); await new Promise(resolve => setImmediate(resolve));
    const current = await records.findById(created.id); assert.equal(current?.version, 2); assert.equal((current?.content.blocks[0] as { description?: string }).description, undefined);
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record HTTP accepts source and requires a valid user header", async () => {
  const path = `/tmp/fanto-http-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    const records = new SqliteRecordRepository(db); const media = new SqliteMediaRepository(db); const app = createApp(records, media, new LocalMediaQueue(), { readUrl: () => "https://private.example", putUrl: () => "https://upload.example" } as any, { apiKey: "", asrBaseUrl: "", vlBaseUrl: "" });
    const created = await app.request("/api/records", { method: "POST", headers: { "Content-Type": "application/json", "x-user-id": "u" }, body: JSON.stringify({ text: "with source", media: [], source: "capture" }) });
    assert.equal(created.status, 201); assert.equal((await created.json() as any).result.source, "capture");
    const unauthorized = await app.request("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "no user", media: [] }) });
    assert.equal(unauthorized.status, 401);
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record rejects image-only content and requires ready media", async () => {
  const path = `/tmp/fanto-content-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); const imageId = randomUUID(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    await db.insertInto("media_assets").values({ media_id: imageId, user_id: "u", object_key: "private/image", media_type: "image", mime_type: "image/png", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db);
    assert.equal(await records.create({ userId: "u", value: { text: "", media: [{ mediaId: imageId }] } }), "invalid_content");
    await db.updateTable("media_assets").set({ status: "uploading" }).where("media_id", "=", imageId).execute();
    assert.equal(await records.create({ userId: "u", value: { text: "caption", media: [{ mediaId: imageId }] } }), "invalid_media");
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});
