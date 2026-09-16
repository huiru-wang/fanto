import { createHash } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { RecordContent } from "@fanto/shared";
import type { AppConfig } from "../../bootstrap/config.js";
import { EmbeddingsClient } from "../../infrastructure/clients/embeddings-client.js";
import type { DB } from "../../infrastructure/database/schema.js";
import { nowIso } from "../../infrastructure/time.js";

type VectorRow = { id: number; distance: number };
export type RecordVectorTask = { userId: string; recordId: string; operation: "upsert" | "replace" };

export class RecordMemoryService {
  private readonly embeddings: EmbeddingsClient;
  constructor(private db: Kysely<DB>, config: AppConfig) {
    if (config.embeddingDimension !== 1536) throw new Error("record_vectors requires EMBEDDING_DIMENSION=1536");
    this.embeddings = new EmbeddingsClient(config.embeddingApiKey ?? "", config.embeddingApiBase, config.embeddingModel, config.embeddingDimension);
  }

  async index(task: RecordVectorTask) {
    if (task.operation === "replace") await this.remove(task.userId, task.recordId);
    const content = await this.content(task.userId, task.recordId);
    if (!content) return;
    const hash = createHash("sha256").update(content).digest("hex");
    const existing = await this.db.selectFrom("vector_items").select("id").where("user_id", "=", task.userId).where("type", "=", "record").where("outer_id", "=", task.recordId).where("content_hash", "=", hash).where("status", "=", "indexed").executeTakeFirst();
    if (existing) return;
    const embedding = await this.embeddings.embed(content); const now = nowIso();
    await sql`INSERT INTO record_vectors(embedding) VALUES (${JSON.stringify(embedding)})`.execute(this.db);
    const vector = await sql<{ id: number }>`SELECT last_insert_rowid() AS id`.execute(this.db);
    const id = Number(vector.rows[0]?.id);
    await this.db.insertInto("vector_items").values({ id, user_id: task.userId, type: "record", outer_id: task.recordId, content, content_hash: hash, status: "indexed", error_code: null, indexed_at: now, created_at: now }).execute();
  }

  async search(userId: string, query: string, limit: number) {
    const embedding = await this.embeddings.embed(query);
    const candidates = await sql<VectorRow>`SELECT rowid AS id, distance FROM record_vectors WHERE embedding MATCH ${JSON.stringify(embedding)} AND k = ${limit * 4}`.execute(this.db);
    if (!candidates.rows.length) return [];
    const ids = candidates.rows.map(row => row.id);
    const rows = await this.db.selectFrom("vector_items").select(["id", "outer_id", "content"]).where("id", "in", ids).where("user_id", "=", userId).where("type", "=", "record").where("status", "=", "indexed").execute();
    const byId = new Map(rows.map(row => [row.id, row]));
    return candidates.rows.flatMap(row => { const item = byId.get(row.id); return item ? [{ recordId: item.outer_id, snippet: item.content.slice(0, 1_000), score: row.distance }] : []; }).slice(0, limit);
  }

  async getRecords(userId: string, recordIds: string[]) {
    if (!recordIds.length) return [];
    const records = await this.db.selectFrom("records").selectAll().where("user_id", "=", userId).where("record_id", "in", recordIds).execute();
    return records.map(row => { const content = JSON.parse(row.content) as RecordContent; return { recordId: row.record_id, text: content.text, createdAt: row.created_at, updatedAt: row.updated_at, media: content.blocks.map(block => block.type === "image" ? { mediaId: block.mediaId, type: "image", description: block.description ?? null } : { mediaId: block.mediaId, type: "audio", asrTranscript: block.transcription ?? null }) }; });
  }

  private async remove(userId: string, recordId: string) {
    const rows = await this.db.selectFrom("vector_items").select("id").where("user_id", "=", userId).where("type", "=", "record").where("outer_id", "=", recordId).execute();
    for (const row of rows) await sql`DELETE FROM record_vectors WHERE rowid = ${Number(row.id)}`.execute(this.db);
    await this.db.deleteFrom("vector_items").where("user_id", "=", userId).where("type", "=", "record").where("outer_id", "=", recordId).execute();
  }

  private async content(userId: string, recordId: string) {
    const record = await this.db.selectFrom("records").select("content").where("record_id", "=", recordId).where("user_id", "=", userId).executeTakeFirst();
    if (!record) return null;
    const content = JSON.parse(record.content) as RecordContent;
    const parts = [content.text.trim() ? `用户记录：${content.text.trim()}` : "", ...content.blocks.flatMap(block => block.type === "image" && block.description?.trim() ? [`图片描述：${block.description.trim()}`] : block.type === "audio" && block.transcription?.trim() ? [`音频转写：${block.transcription.trim()}`] : [])].filter(Boolean);
    return parts.length ? parts.join("\n") : null;
  }
}
