import assert from "node:assert/strict";
import test from "node:test";
import type { Record } from "../records/record.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import type { MemoryIndex } from "./memory-index.js";
import type { MemoryDocument, MemoryIndexHit, MemoryRef } from "./model.js";
import { MemoryService } from "./memory-service.js";
import { buildRecordMemoryDocument } from "./record-memory.js";

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

test("record memory builder preserves record and block order with stable hash", () => {
  const first = buildRecordMemoryDocument(record());
  const second = buildRecordMemoryDocument(record());
  assert.ok(first);
  assert.equal(first.content, "用户记录：准备雨衣\n音频转写：周末去西山徒步\n图片描述：雨衣和登山杖放在玄关。");
  assert.equal(first.contentHash, second?.contentHash);
  assert.equal(first.userId, "user-1");
  assert.equal(first.sourceId, "record-1");
});

test("record memory builder returns null when there is no indexable content", () => {
  assert.equal(buildRecordMemoryDocument(record({ content: { text: "   ", blocks: [{ type: "audio", mediaId: "audio-1" }] } })), null);
});

class FakeIndex implements MemoryIndex {
  current = false;
  replaced: Array<{ document: MemoryDocument; embedding: number[] }> = [];
  removed: MemoryRef[] = [];
  searches: unknown[] = [];

  async isCurrent() { return this.current; }
  async replace(document: MemoryDocument, embedding: number[]) { this.replaced.push({ document, embedding }); }
  async remove(ref: MemoryRef) { this.removed.push(ref); }
  async search(input: any): Promise<MemoryIndexHit[]> {
    this.searches.push(input);
    return [{ userId: input.userId, sourceType: "record", sourceId: "record-1", content: "用户记录：命中内容", distance: 0.25 }];
  }
  async reset() {}
}

class FakeEmbeddings implements EmbeddingProvider {
  inputs: string[] = [];
  async embed(text: string) { this.inputs.push(text); return [1, 2, 3]; }
}

test("memory service skips embedding when the indexed content hash is current", async () => {
  const index = new FakeIndex(); index.current = true;
  const embeddings = new FakeEmbeddings();
  const memory = new MemoryService(index, embeddings);
  await memory.replaceRecord(record());
  assert.equal(embeddings.inputs.length, 0);
  assert.equal(index.replaced.length, 0);
});

test("memory service replaces changed record content through ports", async () => {
  const index = new FakeIndex();
  const embeddings = new FakeEmbeddings();
  const memory = new MemoryService(index, embeddings);
  await memory.replaceRecord(record());
  assert.deepEqual(embeddings.inputs, ["用户记录：准备雨衣\n音频转写：周末去西山徒步\n图片描述：雨衣和登山杖放在玄关。"]);
  assert.equal(index.replaced.length, 1);
  assert.deepEqual(index.replaced[0]?.embedding, [1, 2, 3]);
});

test("memory service removes stale index when record has no indexable content", async () => {
  const index = new FakeIndex();
  const embeddings = new FakeEmbeddings();
  const memory = new MemoryService(index, embeddings);
  await memory.replaceRecord(record({ content: { text: "", blocks: [] } }));
  assert.deepEqual(index.removed, [{ userId: "user-1", sourceType: "record", sourceId: "record-1" }]);
  assert.equal(embeddings.inputs.length, 0);
});

test("memory service searches records within the requested user scope", async () => {
  const index = new FakeIndex();
  const embeddings = new FakeEmbeddings();
  const memory = new MemoryService(index, embeddings);
  assert.deepEqual(await memory.searchRecords({ userId: "user-1", query: "徒步", limit: 5 }), [{
    sourceType: "record",
    sourceId: "record-1",
    snippet: "用户记录：命中内容",
    distance: 0.25,
  }]);
  assert.deepEqual(index.searches, [{ userId: "user-1", sourceType: "record", embedding: [1, 2, 3], limit: 5 }]);
});
