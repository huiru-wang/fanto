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
import { MemoryService } from "../memory/memory-service.js";
import { EmbeddingsClient } from "../../infrastructure/clients/embeddings-client.js";
import { SqliteVecMemoryIndex } from "../../infrastructure/memory/sqlite-vec-memory-index.js";
import { encodeRecordCursor } from "./cursor.js";

test("timestamps are stored in UTC ISO format", () => {
  assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T.*Z$/);
});

test("postprocess writes audio transcription and annotations to Record media", async () => {
  const path = `/tmp/fanto-asr-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); const mediaId = randomUUID(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: "private/audio", media_type: "audio", mime_type: "audio/mp4", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const record = await records.create({ userId: "u", eventAt: now, value: { text: "手写文本", media: [{ mediaId }] } });
    assert.notEqual(typeof record, "string"); if (typeof record === "string") return;
    const runId = randomUUID(); assert.ok(await records.claimPostprocess({ recordId: record.id, userId: "u", version: 1, runId }));
    const completed = await records.completePostprocess({ recordId: record.id, userId: "u", version: 1, runId, images: [], audio: [{ mediaId, transcription: "语音转写", asr: { status: "succeeded", model: "qwen3-asr-flash", emotion: "neutral", language: "zh", completedAt: now } }] });
    assert.equal(completed?.status, "processed");
    const saved = await records.findById(record.id); assert.equal((saved?.content.blocks[0] as { transcription?: string }).transcription, "语音转写"); assert.equal(saved?.status, "processed");
    const media = new SqliteMediaRepository(db); const asset = await media.findMedia(mediaId, "u"); assert.deepEqual(asset?.extData.asr, { status: "succeeded", model: "qwen3-asr-flash", emotion: "neutral", language: "zh", completedAt: now });
    const app = createApp(records, media, new RecordPostprocessQueue(), {} as any); const response = await app.request(`/api/records/${record.id}`, { headers: { "x-user-id": "u" } });
    assert.deepEqual((await response.json() as any).result.media[0].asr, { status: "succeeded", transcript: "语音转写", model: "qwen3-asr-flash", emotion: "neutral", language: "zh", completedAt: now, errorCode: null });
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record memory indexes processed Record content through MemoryService", async () => {
  const path = `/tmp/fanto-vector-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ embedding: Array.from({ length: 768 }, () => 0.1) }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const now = nowIso(); const mediaId = randomUUID(); const imageId = randomUUID(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: "private/audio", media_type: "audio", mime_type: "audio/mp4", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    await db.insertInto("media_assets").values({ media_id: imageId, user_id: "u", object_key: "private/image", media_type: "image", mime_type: "image/png", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const record = await records.create({ userId: "u", eventAt: now, value: { text: "准备雨衣", media: [{ mediaId }, { mediaId: imageId }] } });
    assert.notEqual(typeof record, "string"); if (typeof record === "string") return;
    const runId = randomUUID(); await records.claimPostprocess({ recordId: record.id, userId: "u", version: 1, runId });
    const completed = await records.completePostprocess({ recordId: record.id, userId: "u", version: 1, runId, images: [{ mediaId: imageId, description: "雨衣和登山杖放在玄关。" }], audio: [{ mediaId, transcription: "周末去西山徒步", asr: { status: "succeeded" } }] });
    assert.ok(completed);

    const memory = new MemoryService(
      new SqliteVecMemoryIndex(db),
      new EmbeddingsClient("test", "https://embedding.test/v1", "test", 768),
    );
    await memory.replaceRecord(completed);
    const hits = await memory.searchRecords({ userId: "u", query: "徒步", limit: 5 });
    assert.deepEqual(hits.map(hit => ({ sourceType: hit.sourceType, recordId: hit.recordId, mediaId: hit.mediaId, snippet: hit.snippet, distance: hit.distance })).sort((a, b) => a.sourceType.localeCompare(b.sourceType)), [{
      sourceType: "audio",
      recordId: record.id,
      mediaId,
      snippet: "音频转写：周末去西山徒步",
      distance: 0,
    }, {
      sourceType: "image",
      recordId: record.id,
      mediaId: imageId,
      snippet: "图片描述：雨衣和登山杖放在玄关。",
      distance: 0,
    }, {
      sourceType: "record_text",
      recordId: record.id,
      mediaId: null,
      snippet: "用户记录：准备雨衣",
      distance: 0,
    }]);

    const updated = await records.updateContent(record.id, "u", { value: { text: "准备登山杖", media: [{ mediaId }, { mediaId: imageId }] }, expectedVersion: 1 });
    if (typeof updated === "string") return;
    const updatedRunId = randomUUID(); await records.claimPostprocess({ recordId: record.id, userId: "u", version: updated.version, runId: updatedRunId });
    const updatedCompleted = await records.completePostprocess({ recordId: record.id, userId: "u", version: updated.version, runId: updatedRunId, images: [{ mediaId: imageId, description: "雨衣和登山杖放在玄关。" }], audio: [{ mediaId, transcription: "周末去西山徒步", asr: { status: "succeeded" } }] });
    assert.ok(updatedCompleted);
    await memory.replaceRecord(updatedCompleted);
    const updatedHits = await memory.searchRecords({ userId: "u", query: "徒步", limit: 5 });
    assert.equal(updatedHits.find(hit => hit.sourceType === "record_text")?.snippet, "用户记录：准备登山杖");
    assert.equal((await db.selectFrom("vector_items").selectAll().where("user_id", "=", "u").execute()).length, 3);
  } finally { globalThis.fetch = originalFetch; await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record save links ready media and rejects stale versions", async () => {
  const path = `/tmp/fanto-record-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: nowIso() }).execute();
    const mediaId = randomUUID(); const now = nowIso();
    await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: "private/audio", media_type: "audio", mime_type: "audio/mp4", bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const created = await records.create({ userId: "u", eventAt: now, value: { text: "memo", media: [{ mediaId }] } });
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

test("record list orders and pages by event time", async () => {
  const path = `/tmp/fanto-record-event-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: nowIso() }).execute();
    const records = new SqliteRecordRepository(db);
    const earliest = await records.create({ userId: "u", eventAt: "2026-09-17T00:00:00.000Z", value: { text: "最早发生", media: [] } });
    const latest = await records.create({ userId: "u", eventAt: "2026-09-17T12:00:00.000Z", value: { text: "最后发生", media: [] } });
    assert.notEqual(typeof earliest, "string"); assert.notEqual(typeof latest, "string"); if (typeof earliest === "string" || typeof latest === "string") return;
    const page = await records.findByUserId("u", { limit: 1 });
    assert.deepEqual(page.map(record => record.id), [latest.id]);
    const cursor = encodeRecordCursor(page[0]);
    assert.deepEqual((await records.findByUserId("u", { cursor, limit: 1 })).map(record => record.id), [earliest.id]);
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record postprocess writes image and audio results once, then indexes", async () => {
  const path = `/tmp/fanto-image-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); const imageId = randomUUID(); const audioId = randomUUID(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    for (const [mediaId, mediaType, mimeType] of [[imageId, "image", "image/png"], [audioId, "audio", "audio/mpeg"]] as const) await db.insertInto("media_assets").values({ media_id: mediaId, user_id: "u", object_key: `private/${mediaId}`, media_type: mediaType, mime_type: mimeType, bytes: 3, status: "ready", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now }).execute();
    const records = new SqliteRecordRepository(db); const media = new SqliteMediaRepository(db); const created = await records.create({ userId: "u", eventAt: now, value: { text: "photo", media: [{ mediaId: imageId }, { mediaId: audioId }] } });
    assert.notEqual(typeof created, "string"); if (typeof created === "string") return;
    const indexed: Array<{ id: string; status: string }> = []; const queue = new RecordPostprocessQueue(); registerRecordPostprocessListener(queue, records, media, { readUrl: (key: string) => `https://private.example/${key}` } as any, { describe: async () => ({ description: "一棵树。" }) }, { transcribe: async () => ({ transcript: "鸟鸣很清楚", model: "qwen3-asr-flash" }) }, { replaceRecord: async (record: any) => { indexed.push({ id: record.id, status: record.status }); } } as any);
    queue.publish({ recordId: created.id, userId: "u", version: created.version }); queue.publish({ recordId: created.id, userId: "u", version: created.version }); await new Promise(resolve => setTimeout(resolve, 20));
    const saved = await records.findById(created.id); assert.equal((saved?.content.blocks[0] as { description?: string }).description, "一棵树。"); assert.equal((saved?.content.blocks[1] as { transcription?: string }).transcription, "鸟鸣很清楚"); assert.equal(saved?.status, "processed"); assert.deepEqual(indexed, [{ id: created.id, status: "processed" }]);
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("memory indexing failure does not roll back a processed Record", async () => {
  const path = `/tmp/fanto-memory-failure-${randomUUID()}.sqlite`; const db = createDatabase(path); await runMigrations(db);
  try {
    const now = nowIso(); await db.insertInto("users").values({ user_id: "u", wx_openid: "u", created_at: now }).execute();
    const records = new SqliteRecordRepository(db); const media = new SqliteMediaRepository(db);
    const created = await records.create({ userId: "u", eventAt: now, value: { text: "should stay processed", media: [] } });
    assert.notEqual(typeof created, "string"); if (typeof created === "string") return;

    const queue = new RecordPostprocessQueue();
    registerRecordPostprocessListener(
      queue,
      records,
      media,
      {} as any,
      {} as any,
      {} as any,
      { replaceRecord: async () => { throw new Error("embedding unavailable"); } } as any,
    );

    queue.publish({ recordId: created.id, userId: "u", version: created.version });
    await new Promise(resolve => setTimeout(resolve, 20));

    const saved = await records.findById(created.id);
    assert.equal(saved?.status, "processed");
    assert.equal(saved?.taskId, null);
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
    const created = await app.request("/api/records", { method: "POST", headers: { "Content-Type": "application/json", "x-user-id": "u" }, body: JSON.stringify({ text: "with source", media: [], source: "capture", eventAt: "2026-09-17T10:30:00+08:00" }) });
    assert.equal(created.status, 201); const createdBody = await created.json() as any; assert.equal(createdBody.result.source, "capture"); assert.equal(createdBody.result.eventAt, "2026-09-17T02:30:00.000Z");
    assert.equal((await app.request("/api/records", { method: "POST", headers: { "Content-Type": "application/json", "x-user-id": "u" }, body: JSON.stringify({ text: "missing event time", media: [] }) })).status, 400);
    const unauthorized = await app.request("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "no user", media: [], eventAt: "2026-09-17T10:30:00+08:00" }) });
    assert.equal(unauthorized.status, 401);
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});

test("record search HTTP is user-scoped and validates input", async () => {
  const calls: unknown[] = [];
  const memory = {
    searchRecords: async (input: unknown) => {
      calls.push(input);
      return [{ sourceType: "record_text", sourceId: "record-1", recordId: "record-1", mediaId: null, snippet: "用户记录：AI Coding", distance: 0.1 }];
    },
  };
  const app = createApp({} as any, {} as any, new RecordPostprocessQueue(), {} as any, undefined, undefined, memory as any);

  const response = await app.request("/api/records/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": "u1" },
    body: JSON.stringify({ query: "  AI Coding  ", limit: 5 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    result: { data: [{ recordId: "record-1", sourceType: "record_text", mediaId: null, snippet: "用户记录：AI Coding", distance: 0.1 }] },
    errorCode: null,
    errorMsg: null,
  });
  assert.deepEqual(calls, [{ userId: "u1", query: "AI Coding", limit: 5 }]);

  assert.equal((await app.request("/api/records/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": "u1" },
    body: JSON.stringify({ query: "   " }),
  })).status, 400);
  assert.equal((await app.request("/api/records/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": "u1" },
    body: JSON.stringify({ query: "x", limit: 21 }),
  })).status, 400);
  assert.equal((await app.request("/api/records/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "x" }),
  })).status, 401);
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
    assert.equal(await records.create({ userId: "u", eventAt: now, value: { text: "", media: [{ mediaId: imageId }] } }), "invalid_content");
    await db.updateTable("media_assets").set({ status: "uploading" }).where("media_id", "=", imageId).execute();
    assert.equal(await records.create({ userId: "u", eventAt: now, value: { text: "caption", media: [{ mediaId: imageId }] } }), "invalid_media");
  } finally { await db.destroy(); await rm(path, { force: true }); await rm(`${path}-wal`, { force: true }); await rm(`${path}-shm`, { force: true }); }
});
