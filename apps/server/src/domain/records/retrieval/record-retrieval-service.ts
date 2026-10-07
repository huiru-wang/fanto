import { ProjectService } from "../../projects/index.js";
import type { Record } from "../record.js";
import { PostgresRecordRepository } from "../postgres-repository.js";
import type { RecordRepository } from "../repository.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import type { RecordSearchResult } from "./model.js";
import { buildRecordEmbeddingText, recordSearchPreview } from "./record-document.js";
import type { Kysely } from "kysely";
import type { DB } from "../../../infrastructure/database/schema.js";

export class RecordRetrievalService {
  constructor(private readonly records: Pick<RecordRepository, "writeEmbedding" | "searchByEmbedding">, private readonly embeddings: EmbeddingProvider) {}

  static create(db: Kysely<DB>, embeddings: EmbeddingProvider): RecordRetrievalService {
    return new RecordRetrievalService(new PostgresRecordRepository(db, ProjectService.removeRecordReferences), embeddings);
  }

  async replaceRecord(record: Record): Promise<void> {
    const content = buildRecordEmbeddingText(record);
    if (!content) return;
    await this.records.writeEmbedding({
      userId: record.userId,
      recordId: record.id,
      version: record.version,
      embedding: await this.embeddings.embed(content),
    });
  }

  async searchRecords(input: { userId: string; query: string; limit: number }): Promise<RecordSearchResult[]> {
    const embedding = await this.embeddings.embed(input.query);
    const hits = await this.records.searchByEmbedding({ userId: input.userId, embedding, limit: input.limit });
    return hits.map(({ record, distance }) => ({ recordId: record.id, eventAt: record.eventAt, preview: recordSearchPreview(record), distance }));
  }
}
