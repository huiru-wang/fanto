import assert from "node:assert/strict";
import test from "node:test";
import type { RecordRepository } from "./repository.js";
import type { Record } from "./record.js";
import { encodeRecordCursor } from "./cursor.js";
import { RecordService } from "./record-service.js";
import { RecordPostprocessQueue } from "../../event/record-postprocess-queue.js";
import { TtlCache } from "../../infrastructure/cache/ttl-cache.js";

function record(id: string): Record {
  return {
    extData: null,
    id,
    userId: "user-1",
    source: "test",
    content: {
      text: "hello",
      blocks: [{
        type: "audio",
        mediaId: "audio-1",
        durationMs: 12_000,
        transcription: "hello",
        asr: { status: "succeeded", language: "zh" },
      }],
    },
    version: 1,
    status: "processed",
    taskId: "internal-task",
    eventAt: "2026-09-29T00:00:00.000Z",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
}

function createRepository(rows: Record[]) {
  const listCalls: Array<{ cursor?: string; limit: number }> = [];
  const repo: RecordRepository = {
    async findByUserId(_userId, options) {
      listCalls.push(options);
      return rows.slice(0, options.limit);
    },
    async create() { return record("created"); },
    async findById(id) { return record(id); },
    async findByIds(_userId, ids) { return ids.map(record); },
    async updateContent(id) { return record(id); },
    async delete(id) { return {record:record(id),objectKeys:[]}; },
    async claimPostprocess(input) { return record(input.recordId); },
    async completePostprocess(input) { return record(input.recordId); },
    async releasePostprocess() {},
    async writeEmbedding() { return true; },
    async searchByEmbedding() { return []; },
  };
  return { repo, listCalls };
}

test("RecordService list is a direct record projection without media enrichment", async () => {
  const { repo, listCalls } = createRepository([record("r2"), record("r1")]);
  const service = new RecordService(repo, new RecordPostprocessQueue());
  const result = await service.list("user-1", undefined, 1);

  assert.equal(listCalls[0]?.limit, 2);
  assert.equal(result.pageSize, 1);
  assert.equal(result.hasMore, true);
  assert.equal(result.data.length, 1);
  assert.equal("media" in result.data[0]!, false);
  assert.equal("taskId" in result.data[0]!, false);
  assert.equal(result.data[0]!.content.blocks[0]!.type, "audio");
  assert.equal((result.data[0]!.content.blocks[0] as { durationMs?: number }).durationMs, 12_000);
});

test("RecordService caches one top-10 window and bypasses cache for cursor or limit > 10", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => record(`r-${index}`));
  const { repo, listCalls } = createRepository(rows);
  const cache = new TtlCache<string, { records: Record[]; hasMoreAfterTopTen: boolean }>({
    ttlMs: 30_000,
    maxEntries: 10,
  });
  const service = new RecordService(repo, new RecordPostprocessQueue(), undefined, cache);

  const firstFive = await service.list("user-1", undefined, 5);
  assert.equal(listCalls.length, 1);
  assert.deepEqual(listCalls[0], { limit: 11 });
  assert.equal(firstFive.data.length, 5);
  assert.equal(firstFive.hasMore, true);

  const firstTen = await service.list("user-1", undefined, 10);
  assert.equal(listCalls.length, 1);
  assert.equal(firstTen.data.length, 10);
  assert.equal(firstTen.hasMore, true);

  const cursor = encodeRecordCursor(rows[4]!);
  await service.list("user-1", cursor, 5);
  assert.equal(listCalls.length, 2);
  assert.deepEqual(listCalls[1], { cursor, limit: 6 });

  await service.list("user-1", undefined, 11);
  assert.equal(listCalls.length, 3);
  assert.deepEqual(listCalls[2], { cursor: undefined, limit: 12 });
});

test("RecordService invalidates first-page cache after CRUD and postprocess writes", async () => {
  const rows = Array.from({ length: 11 }, (_, index) => record(`r-${index}`));
  const { repo, listCalls } = createRepository(rows);
  const cache = new TtlCache<string, { records: Record[]; hasMoreAfterTopTen: boolean }>({
    ttlMs: 30_000,
    maxEntries: 10,
  });
  const service = new RecordService(repo, new RecordPostprocessQueue(), undefined, cache);

  const warm = async () => {
    await service.list("user-1", undefined, 10);
    return listCalls.length;
  };

  assert.equal(await warm(), 1);
  await service.create("user-1", {
    text: "created",
    media: [],
    eventAt: "2026-09-29T00:00:00.000Z",
  });
  assert.equal(await warm(), 2);

  await service.update("user-1", "r-0", { text: "updated", media: [], expectedVersion: 1 });
  assert.equal(await warm(), 3);

  await service.delete("user-1", "r-0", 1);
  assert.equal(await warm(), 4);

  await service.claimPostprocess({ recordId: "r-0", userId: "user-1", version: 1, runId: "run-1" });
  assert.equal(await warm(), 5);

  await service.completePostprocess({
    recordId: "r-0",
    userId: "user-1",
    version: 1,
    runId: "run-1",
    images: [],
    audio: [],
  });
  assert.equal(await warm(), 6);

  await service.releasePostprocess({ recordId: "r-0", userId: "user-1", version: 1, runId: "run-1" });
  assert.equal(await warm(), 7);
});
