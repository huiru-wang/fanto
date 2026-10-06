import { sql, type Kysely } from "kysely";
import type { DB } from "../../../infrastructure/database/schema.js";
import { nowIso } from "../../../infrastructure/time.js";
import type { RecordIndex } from "./record-index.js";
import type { RecordIndexDocument, RecordIndexHit, RecordIndexRef, RecordIndexSourceType } from "./model.js";

const MEDIA_TYPES: RecordIndexSourceType[] = ["image", "audio"];
const vectorLiteral = (embedding: number[]) => JSON.stringify(embedding);

export class PostgresRecordIndex implements RecordIndex {
  constructor(private readonly db: Kysely<DB>) {}
  async isCurrent(ref: RecordIndexRef, contentHash: string, eventAt: string): Promise<boolean> {
    return Boolean(await this.db.selectFrom("vector_items").select("id").where("user_id", "=", ref.userId).where("type", "=", ref.sourceType).where("outer_id", "=", ref.sourceId).where("content_hash", "=", contentHash).where("event_at", "=", eventAt).where("status", "=", "indexed").executeTakeFirst());
  }
  async replace(document: RecordIndexDocument, embedding: number[]): Promise<void> {
    await this.db.transaction().execute(async trx => {
      await trx.deleteFrom("vector_items").where("user_id", "=", document.userId).where("type", "=", document.sourceType).where("outer_id", "=", document.sourceId).execute();
      const now = nowIso();
      await sql`INSERT INTO vector_items (user_id, type, outer_id, content, content_hash, status, error_code, event_at, indexed_at, created_at, embedding) VALUES (${document.userId}, ${document.sourceType}, ${document.sourceId}, ${document.content}, ${document.contentHash}, 'indexed', NULL, ${document.eventAt}, ${now}, ${now}, ${vectorLiteral(embedding)}::vector)`.execute(trx);
    });
  }
  async remove(ref: RecordIndexRef): Promise<void> { await this.db.deleteFrom("vector_items").where("user_id", "=", ref.userId).where("type", "=", ref.sourceType).where("outer_id", "=", ref.sourceId).execute(); }
  async listRecordRefs(userId: string, recordId: string): Promise<RecordIndexRef[]> {
    const rows = await this.db.selectFrom("vector_items").select(["type", "outer_id"]).where("user_id", "=", userId).where("status", "=", "indexed").where(eb => eb.or([eb.and([eb("type", "=", "record_text"), eb("outer_id", "=", recordId)]), eb.and([eb("type", "in", MEDIA_TYPES), eb("outer_id", "like", `${recordId}:%`)])])).execute();
    return rows.map(row => ({ userId, sourceType: row.type as RecordIndexSourceType, sourceId: row.outer_id }));
  }
  async search(input: { userId: string; sourceTypes: RecordIndexSourceType[]; embedding: number[]; limit: number }): Promise<RecordIndexHit[]> {
    if (!input.sourceTypes.length) return [];
    const rows = await sql<{ user_id: string; type: string; outer_id: string; event_at: string; content: string; distance: number }>`SELECT user_id, type, outer_id, event_at, content, (embedding <-> ${vectorLiteral(input.embedding)}::vector)::float8 AS distance FROM vector_items WHERE user_id = ${input.userId} AND status = 'indexed' AND type IN (${sql.join(input.sourceTypes)}) ORDER BY embedding <-> ${vectorLiteral(input.embedding)}::vector LIMIT ${input.limit}`.execute(this.db);
    return rows.rows.map(row => ({ userId: row.user_id, sourceType: row.type as RecordIndexSourceType, sourceId: row.outer_id, eventAt: row.event_at, content: row.content, distance: Number(row.distance) }));
  }
}
