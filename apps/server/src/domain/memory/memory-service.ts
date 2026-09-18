import type { Record } from "../records/record.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import type { MemoryIndex } from "./memory-index.js";
import type { MemoryRef, MemorySearchResult } from "./model.js";
import { buildRecordMemoryDocument } from "./record-memory.js";

const recordRef = (userId: string, recordId: string): MemoryRef => ({
  userId,
  sourceType: "record",
  sourceId: recordId,
});

export class MemoryService {
  constructor(
    private readonly index: MemoryIndex,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async replaceRecord(record: Record): Promise<void> {
    const document = buildRecordMemoryDocument(record);
    if (!document) {
      await this.index.remove(recordRef(record.userId, record.id));
      return;
    }
    if (await this.index.isCurrent(document, document.contentHash)) return;
    const embedding = await this.embeddings.embed(document.content);
    await this.index.replace(document, embedding);
  }

  async removeRecord(input: { userId: string; recordId: string }): Promise<void> {
    await this.index.remove(recordRef(input.userId, input.recordId));
  }

  async searchRecords(input: { userId: string; query: string; limit: number }): Promise<MemorySearchResult[]> {
    const embedding = await this.embeddings.embed(input.query);
    const hits = await this.index.search({
      userId: input.userId,
      sourceType: "record",
      embedding,
      limit: input.limit,
    });
    return hits.map(hit => ({
      sourceType: hit.sourceType,
      sourceId: hit.sourceId,
      snippet: hit.content.slice(0, 1_000),
      distance: hit.distance,
    }));
  }
}
