import { sql, type Kysely } from "kysely";
import type { MemoryIndex } from "../../domain/memory/memory-index.js";
import type { MemoryDocument, MemoryIndexHit, MemoryRef, MemorySourceType } from "../../domain/memory/model.js";
import type { DB } from "../database/schema.js";
import { nowIso } from "../time.js";

const MEDIA_TYPES: MemorySourceType[] = ["image", "audio"];
const vectorLiteral = (embedding: number[]) => JSON.stringify(embedding);

export class PostgresMemoryIndex implements MemoryIndex {
  constructor(private readonly db: Kysely<DB>) {}

  async isCurrent(ref: MemoryRef, contentHash: string, eventAt: string): Promise<boolean> {
    const row = await this.db.selectFrom("vector_items").select("id")
      .where("user_id", "=", ref.userId).where("type", "=", ref.sourceType)
      .where("outer_id", "=", ref.sourceId).where("content_hash", "=", contentHash)
      .where("event_at", "=", eventAt).where("status", "=", "indexed").executeTakeFirst();
    return Boolean(row);
  }

  async replace(document: MemoryDocument, embedding: number[]): Promise<void> {
    await this.db.transaction().execute(async trx => {
      await trx.deleteFrom("vector_items").where("user_id", "=", document.userId)
        .where("type", "=", document.sourceType).where("outer_id", "=", document.sourceId).execute();
      const now = nowIso();
      await sql`
        INSERT INTO vector_items (user_id, type, outer_id, content, content_hash, status, error_code, event_at, indexed_at, created_at, embedding)
        VALUES (${document.userId}, ${document.sourceType}, ${document.sourceId}, ${document.content}, ${document.contentHash}, 'indexed', NULL, ${document.eventAt}, ${now}, ${now}, ${vectorLiteral(embedding)}::vector)
      `.execute(trx);
    });
  }

  async remove(ref: MemoryRef): Promise<void> {
    await this.db.deleteFrom("vector_items").where("user_id", "=", ref.userId)
      .where("type", "=", ref.sourceType).where("outer_id", "=", ref.sourceId).execute();
  }

  async listRecordRefs(userId: string, recordId: string): Promise<MemoryRef[]> {
    const rows = await this.db.selectFrom("vector_items").select(["type", "outer_id"])
      .where("user_id", "=", userId).where("status", "=", "indexed")
      .where(eb => eb.or([
        eb.and([eb("type", "=", "record_text"), eb("outer_id", "=", recordId)]),
        eb.and([eb("type", "in", MEDIA_TYPES), eb("outer_id", "like", `${recordId}:%`)]),
      ])).execute();
    return rows.map(row => ({ userId, sourceType: row.type as MemorySourceType, sourceId: row.outer_id }));
  }

  async search(input: { userId: string; sourceTypes: MemorySourceType[]; embedding: number[]; limit: number }): Promise<MemoryIndexHit[]> {
    if (!input.sourceTypes.length) return [];
    const rows = await sql<{ user_id: string; type: string; outer_id: string; event_at: string; content: string; distance: number }>`
      SELECT user_id, type, outer_id, event_at, content, (embedding <-> ${vectorLiteral(input.embedding)}::vector)::float8 AS distance
      FROM vector_items
      WHERE user_id = ${input.userId} AND status = 'indexed' AND type IN (${sql.join(input.sourceTypes)})
      ORDER BY embedding <-> ${vectorLiteral(input.embedding)}::vector
      LIMIT ${input.limit}
    `.execute(this.db);
    return rows.rows.map(row => ({ userId: row.user_id, sourceType: row.type as MemorySourceType, sourceId: row.outer_id, eventAt: row.event_at, content: row.content, distance: Number(row.distance) }));
  }

  async reset(): Promise<void> {
    await this.db.deleteFrom("vector_items").execute();
  }
}
