import type { Record } from "../records/record.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import type { MemoryIndex } from "./memory-index.js";
import type { MemoryRef, MemorySearchResult } from "./model.js";
import { buildRecordMemoryDocuments, parseMemorySource } from "./record-memory.js";

const refKey = (ref: MemoryRef) => `${ref.sourceType}:${ref.sourceId}`;

export class MemoryService {
  constructor(
    private readonly index: MemoryIndex,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async replaceRecord(record: Record): Promise<void> {
    const documents = buildRecordMemoryDocuments(record);
    const existing = await this.index.listRecordRefs(record.userId, record.id);
    const desired = new Set(documents.map(refKey));

    for (const ref of existing) {
      if (!desired.has(refKey(ref))) await this.index.remove(ref);
    }

    for (const document of documents) {
      if (await this.index.isCurrent(document, document.contentHash, document.eventAt)) continue;
      const embedding = await this.embeddings.embed(document.content);
      await this.index.replace(document, embedding);
    }
  }

  async removeRecord(input: { userId: string; recordId: string }): Promise<void> {
    const refs = await this.index.listRecordRefs(input.userId, input.recordId);
    await Promise.all(refs.map(ref => this.index.remove(ref)));
  }

  async searchRecords(input: { userId: string; query: string; limit: number }): Promise<MemorySearchResult[]> {
    const embedding = await this.embeddings.embed(input.query);
    const hits = await this.index.search({
      userId: input.userId,
      sourceTypes: ["record_text", "image", "audio"],
      embedding,
      limit: input.limit,
    });
    return hits.map(hit => {
      const source = parseMemorySource(hit.sourceType, hit.sourceId);
      return {
        sourceType: hit.sourceType,
        sourceId: hit.sourceId,
        recordId: source.recordId,
        mediaId: source.mediaId,
        snippet: hit.content.slice(0, 1_000),
        distance: hit.distance,
        eventAt: hit.eventAt,
      };
    });
  }
}
