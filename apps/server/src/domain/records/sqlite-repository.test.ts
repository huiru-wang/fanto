import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import test from "node:test";
import { createDatabase, runMigrations } from "../../infrastructure/database/database.js";
import { SqliteRecordRepository } from "./sqlite-repository.js";
import { SqliteMediaRepository } from "../media/sqlite-repository.js";
import { nowIso } from "../../infrastructure/time.js";
import { RecordPostprocessQueue } from "../../infrastructure/queue/record-postprocess-queue.js";
import { registerRecordPostprocessListener } from "../../listeners/record-postprocess.listener.js";
import { createApp } from "../../bootstrap/app.js";
import { RecordMemoryService } from "../memory/record-index.js";

test("timestamps are stored in UTC ISO format", () => {
  assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T.*Z$/);
});

test("postprocess writes audio transcription and annotations to Record media", async () => {
  const path = `/tmp/fanto-asr-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); const mediaId = randomUUID(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: "private/audio", media_type: "audio", mime_type: "audio/mp4", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const record = await records.create({ userId: "u", value: { text: "手写文本", media: [{ mediaId }] } });
    assert.notEqual(typeof record, "string"); if (typeof record === "string") return;
    const runId = randomUUID(); assert.ok(await records.claimPostprocess({ recordId: record.id, userId: "u", version: 1, runId }));
    assert.equal(await records.completePostprocess({ recordId: record.id, userId: "u", version: 1, runId, images: [], audio: [{ mediaId, transcription: "语音转写", asr: { status: "succeeded", model: "qwen3-asr-flash", emotion: "neutral", language: "zh", completedAt: now } }] }), true);
    const saved = await records.findById(record.id); assert.equal((saved?.content.blocks[0] as { transcription?: string }).transcription, "语音转写"); assert.equal(saved?.status, "processed");
    const media = new SqliteMediaRepository(db); const asset = await media.findMedia(mediaId, "u"); assert.deepEqual(asset?.extData.asr, { status: "succeeded", model: "qwen3-asr-flash", emotion: "neutral", language: "zh", completedAt: now });
    const app = createApp(records, media, new RecordPostprocessQueue(), {} as any); const response = await app.request(`/api/records/${record.id}`, { headers: { "x-user-id": "u" } });
    assert.deepEqual((await response.json() as any).result.media[0].asr, { status: "succeeded", transcript: "语音转写", model: "qwen3-asr-flash", emotion: "neutral", language: "zh", completedAt: now, errorCode: null });
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record memory indexes text and ASR with record outerId", async () => {
  const path = `/tmp/fanto-vector-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ embedding: Array.from({ length: 1536 }, () => 0.1) }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const now = nowIso(); const mediaId = randomUUID(); const imageId = randomUUID(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: "private/audio", media_type: "audio", mime_type: "audio/mp4", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    await db.insertInto("media_assets").values({ media_id: imageId, user_id: "u", object_key: "private/image", media_type: "image", mime_type: "image/png", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const record = await records.create({ userId: "u", value: { text: "准备雨衣", media: [{ mediaId }, { mediaId: imageId }] } });
    assert.notEqual(typeof record, "string"); if (typeof record === "string") return;
    const runId = randomUUID(); await records.claimPostprocess({ recordId: record.id, userId: "u", version: 1, runId }); await records.completePostprocess({ recordId: record.id, userId: "u", version: 1, runId, images: [{ mediaId: imageId, description: "雨衣和登山杖放在玄关。" }], audio: [{ mediaId, transcription: "周末去西山徒步", asr: { status: "succeeded" } }] });
    const memory = new RecordMemoryService(db, { embeddingApiKey: "test", embeddingApiBase: "https://embedding.test/v1", embeddingModel: "test", embeddingDimension: 1536 } as any);
    await memory.index({ userId: "u", recordId: record.id, operation: "upsert" });
    assert.deepEqual(await memory.search("u", "徒步", 5), [{ recordId: record.id, snippet: "用户记录：准备雨衣\n音频转写：周末去西山徒步\n图片描述：雨衣和登山杖放在玄关。", score: 0 }]);
    const updated = await records.updateContent(record.id, "u", { value: { text: "准备登山杖", media: [{ mediaId }, { mediaId: imageId }] }, expectedVersion: 1 });
    if (typeof updated === "string") return;
    const updatedRunId = randomUUID(); await records.claimPostprocess({ recordId: record.id, userId: "u", version: updated.version, runId: updatedRunId }); await records.completePostprocess({ recordId: record.id, userId: "u", version: updated.version, runId: updatedRunId, images: [{ mediaId: imageId, description: "雨衣和登山杖放在玄关。" }], audio: [{ mediaId, transcription: "周末去西山徒步", asr: { status: "succeeded" } }] });
    assert.notEqual(typeof updated, "string"); await memory.index({ userId: "u", recordId: record.id, operation: "replace" });
    assert.deepEqual(await memory.search("u", "徒步", 5), [{ recordId: record.id, snippet: "用户记录：准备登山杖\n音频转写：周末去西山徒步\n图片描述：雨衣和登山杖放在玄关。", score: 0 }]);
    assert.deepEqual((await memory.getRecords("u", [record.id]))[0]?.media, [{ mediaId, type: "audio", asrTranscript: "周末去西山徒步" }, { mediaId: imageId, type: "image", description: "雨衣和登山杖放在玄关。" }]);
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
    const runId = randomUUID(); assert.ok(await records.claimPostprocess({ recordId: created.id, userId: "u", version: 2, runId }));
    assert.equal(await records.updateContent(created.id, "u", { value: { text: "blocked", media: [{ mediaId }] }, expectedVersion: 2 }), "conflict");
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record postprocess writes image and audio results once, then indexes", async () => {
  const path = `/tmp/fanto-image-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); const imageId = randomUUID(); const audioId = randomUUID(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    for (const [mediaId, mediaType, mimeType] of [[imageId, "image", "image/png"], [audioId, "audio", "audio/mpeg"]] as const) await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: `private/${mediaId}`, media_type: mediaType, mime_type: mimeType, bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const media = new SqliteMediaRepository(db); const created = await records.create({ userId: "u", value: { text: "photo", media: [{ mediaId: imageId }, { mediaId: audioId }] } });
    assert.notEqual(typeof created, "string"); if (typeof created === "string") return;
    const indexed: unknown[] = []; const queue = new RecordPostprocessQueue(); registerRecordPostprocessListener(queue, records, media, { readUrl: (key: string) => `https://private.example/${key}` } as any, { describe: async () => ({ description: "一棵树。" }) }, { transcribe: async () => ({ transcript: "鸟鸣很清楚", model: "qwen3-asr-flash" }) }, { index: async (task: unknown) => { indexed.push(task); } } as any);
    queue.publish({ recordId: created.id, userId: "u", version: created.version }); queue.publish({ recordId: created.id, userId: "u", version: created.version }); await new Promise(resolve => setTimeout(resolve, 20));
    const saved = await records.findById(created.id); assert.equal((saved?.content.blocks[0] as { description?: string }).description, "一棵树。"); assert.equal((saved?.content.blocks[1] as { transcription?: string }).transcription, "鸟鸣很清楚"); assert.equal(saved?.status, "processed"); assert.deepEqual(indexed, [{ userId: "u", recordId: created.id, operation: "replace" }]);
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record HTTP accepts source and requires a valid user header", async () => {
  const path = `/tmp/fanto-http-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    const records = new SqliteRecordRepository(db); const media = new SqliteMediaRepository(db); const app = createApp(records, media, new RecordPostprocessQueue(), { readUrl: (key: string) => `https://private.example/${key}`, putUrl: () => "https://upload.example", head: async () => ({ res: { headers: { "content-length": "3", "content-type": "Audio/MPEG; charset=binary" } } }) } as any);
    const upload = await app.request("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json", "x-user-id": "u" }, body: JSON.stringify({ mimeType: "audio/mpeg; charset=binary", bytes: 3 }) });
    assert.equal(upload.status, 201); const uploaded = (await upload.json() as any).result; assert.equal(uploaded.uploadUrl, "https://upload.example");
    const asset = await media.findMedia(uploaded.mediaId, "u"); assert.equal(asset?.objectKey, `users/u/media/${uploaded.mediaId}.mp3`); assert.equal(asset?.mimeType, "audio/mpeg"); assert.equal(asset?.mediaType, "audio");
    assert.equal((await app.request("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json", "x-user-id": "u" }, body: JSON.stringify({ mimeType: "audio/aac", bytes: 3 }) })).status, 400);
    assert.equal((await app.request("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json", "x-user-id": "u" }, body: JSON.stringify({ fileName: "memo.mp3", mediaType: "audio", mimeType: "audio/mpeg", bytes: 3 }) })).status, 400);
    assert.equal((await app.request(`/api/uploads/${uploaded.mediaId}/complete`, { method: "POST", headers: { "Content-Type": "application/json", "x-user-id": "u" }, body: "{}" })).status, 200);
    assert.equal((await app.request(`/api/media/${uploaded.mediaId}`, { headers: { "x-user-id": "u" } })).status, 302);
    assert.equal((await app.request(`/api/media/${uploaded.mediaId}`, { headers: { "x-user-id": "other" } })).status, 404);
    const created = await app.request("/api/records", { method: "POST", headers: { "Content-Type": "application/json", "x-user-id": "u" }, body: JSON.stringify({ text: "with source", media: [], source: "capture" }) });
    assert.equal(created.status, 201); assert.equal((await created.json() as any).result.source, "capture");
    const unauthorized = await app.request("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "no user", media: [] }) });
    assert.equal(unauthorized.status, 401);
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("HTTP returns a stable JSON envelope for unhandled errors", async () => {
  const app = createApp({} as any, { findMedia: async () => { throw new Error("database connection failed"); } } as any, new RecordPostprocessQueue(), {} as any);
  const response = await app.request(`/api/media/${randomUUID()}`, { headers: { "x-user-id": "u" } });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, errorCode: "INTERNAL_ERROR", errorMsg: "Internal server error" });
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
