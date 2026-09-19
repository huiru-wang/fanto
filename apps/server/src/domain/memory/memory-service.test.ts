import assert from "node:assert/strict";
import test from "node:test";
import type { Record } from "../records/record.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import type { MemoryIndex } from "./memory-index.js";
import type { MemoryDocument, MemoryIndexHit, MemoryRef } from "./model.js";
import { MemoryService } from "./memory-service.js";
import { buildRecordMemoryDocuments, parseMemorySource } from "./record-memory.js";

const record = (overrides: Partial<Record> = {}): Record => ({
  extData: null,
  id: "record-1",
  userId: "user-1",
  source: "home",
  content: { text: "准备雨衣", blocks: [
    { type: "audio", mediaId: "audio-1", transcription: "周末去西山徒步" },
    { type: "image", mediaId: "image-1", description: "雨衣和登山杖放在玄关。" },
  ] },
  version: 1,
  status: "processed",
  taskId: null,
  eventAt: "2026-09-18T00:00:00.000Z",
  createdAt: "2026-09-18T00:00:00.000Z",
  updatedAt: "2026-09-18T00:00:00.000Z",
  ...overrides,
});

test("record memory builder creates independent text, audio, and image documents", () => {
  const first = buildRecordMemoryDocuments(record());
  const second = buildRecordMemoryDocuments(record());
  assert.deepEqual(first.map(item => [item.sourceType, item.recordId, item.mediaId, item.content]), [
    ["record_text", "record-1", null, "用户记录：准备雨衣"],
    ["audio", "record-1", "audio-1", "音频转写：周末去西山徒步"],
    ["image", "record-1", "image-1", "图片描述：雨衣和登山杖放在玄关。"],
  ]);
  assert.deepEqual(first.map(item => item.contentHash), second.map(item => item.contentHash));
});

test("record memory builder ignores blocks without semantic text", () => {
  assert.deepEqual(
    buildRecordMemoryDocuments(record({ content: { text: "   ", blocks: [{ type: "audio", mediaId: "audio-1" }] } })),
    [],
  );
});

test("memory source ids preserve media-to-record association", () => {
  assert.deepEqual(parseMemorySource("record_text", "record-1"), { recordId: "record-1", mediaId: null });
  assert.deepEqual(parseMemorySource("image", "record-1:image-1"), { recordId: "record-1", mediaId: "image-1" });
  assert.deepEqual(parseMemorySource("audio", "record-1:audio-1"), { recordId: "record-1", mediaId: "audio-1" });
});

class FakeIndex implements MemoryIndex {
  current = false;
  existing: MemoryRef[] = [];
  replaced: Array<{ document: MemoryDocument; embedding: number[] }> = [];
  removed: MemoryRef[] = [];
  searches: unknown[] = [];

  async isCurrent() { return this.current; }
  async replace(document: MemoryDocument, embedding: number[]) { this.replaced.push({ document, embedding }); }
  async remove(ref: MemoryRef) { this.removed.push(ref); }
  async listRecordRefs() { return this.existing; }
  async search(input: any): Promise<MemoryIndexHit[]> {
    this.searches.push(input);
    return [{
      userId: input.userId,
      sourceType: "image",
      sourceId: "record-1:image-1",
      content: "图片描述：命中内容",
      distance: 0.25,
    }];
  }
  async reset() {}
}

class FakeEmbeddings implements EmbeddingProvider {
  inputs: string[] = [];
  async embed(text: string) { this.inputs.push(text); return [1, 2, 3]; }
}

test("memory service skips unchanged atomic documents", async () => {
  const index = new FakeIndex(); index.current = true;
  index.existing = buildRecordMemoryDocuments(record()).map(({ userId, sourceType, sourceId }) => ({ userId, sourceType, sourceId }));
  const embeddings = new FakeEmbeddings();
  const memory = new MemoryService(index, embeddings);
  await memory.replaceRecord(record());
  assert.equal(embeddings.inputs.length, 0);
  assert.equal(index.replaced.length, 0);
  assert.equal(index.removed.length, 0);
});

test("memory service embeds each atomic document independently", async () => {
  const index = new FakeIndex();
  const embeddings = new FakeEmbeddings();
  const memory = new MemoryService(index, embeddings);
  await memory.replaceRecord(record());
  assert.deepEqual(embeddings.inputs, [
    "用户记录：准备雨衣",
    "音频转写：周末去西山徒步",
    "图片描述：雨衣和登山杖放在玄关。",
  ]);
  assert.deepEqual(index.replaced.map(item => item.document.sourceType), ["record_text", "audio", "image"]);
});

test("memory service removes stale atomic documents after record changes", async () => {
  const index = new FakeIndex();
  index.existing = [
    { userId: "user-1", sourceType: "record_text", sourceId: "record-1" },
    { userId: "user-1", sourceType: "image", sourceId: "record-1:old-image" },
  ];
  const embeddings = new FakeEmbeddings();
  const memory = new MemoryService(index, embeddings);
  await memory.replaceRecord(record({ content: { text: "准备雨衣", blocks: [] } }));
  assert.deepEqual(index.removed, [{ userId: "user-1", sourceType: "image", sourceId: "record-1:old-image" }]);
});

test("memory service removes all atomic indexes for a record", async () => {
  const index = new FakeIndex();
  index.existing = [
    { userId: "user-1", sourceType: "record_text", sourceId: "record-1" },
    { userId: "user-1", sourceType: "audio", sourceId: "record-1:audio-1" },
  ];
  const memory = new MemoryService(index, new FakeEmbeddings());
  await memory.removeRecord({ userId: "user-1", recordId: "record-1" });
  assert.deepEqual(index.removed, index.existing);
});

test("memory service search exposes source, record association, and distance", async () => {
  const index = new FakeIndex();
  const embeddings = new FakeEmbeddings();
  const memory = new MemoryService(index, embeddings);
  assert.deepEqual(await memory.searchRecords({ userId: "user-1", query: "徒步", limit: 5 }), [{
    sourceType: "image",
    sourceId: "record-1:image-1",
    recordId: "record-1",
    mediaId: "image-1",
    snippet: "图片描述：命中内容",
    distance: 0.25,
  }]);
  assert.deepEqual(index.searches, [{
    userId: "user-1",
    sourceTypes: ["record_text", "image", "audio"],
    embedding: [1, 2, 3],
    limit: 5,
  }]);
});
