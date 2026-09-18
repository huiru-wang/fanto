import { sql, type Kysely } from "kysely";
import type { MemoryIndex } from "../../domain/memory/memory-index.js";
import type { MemoryDocument, MemoryIndexHit, MemoryRef, MemorySourceType } from "../../domain/memory/model.js";
import type { DB } from "../database/schema.js";
import { nowIso } from "../time.js";

type VectorRow = { id: number; distance: number };

export class SqliteVecMemoryIndex implements MemoryIndex {
  constructor(private readonly db: Kysely<DB>) {}

  async isCurrent(ref: MemoryRef, contentHash: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("vector_items")
      .select("id")
      .where("user_id", "=", ref.userId)
      .where("type", "=", ref.sourceType)
      .where("outer_id", "=", ref.sourceId)
      .where("content_hash", "=", contentHash)
      .where("status", "=", "indexed")
      .executeTakeFirst();
    return Boolean(row);
  }

  async replace(document: MemoryDocument, embedding: number[]): Promise<void> {
    await this.db.transaction().execute(async trx => {
      const existing = await trx
        .selectFrom("vector_items")
        .select("id")
        .where("user_id", "=", document.userId)
        .where("type", "=", document.sourceType)
        .where("outer_id", "=", document.sourceId)
        .execute();

      for (const row of existing) {
        await sql`DELETE FROM record_vectors WHERE rowid = ${Number(row.id)}`.execute(trx);
      }
      await trx
        .deleteFrom("vector_items")
        .where("user_id", "=", document.userId)
        .where("type", "=", document.sourceType)
        .where("outer_id", "=", document.sourceId)
        .execute();

      await sql`INSERT INTO record_vectors(user_id, embedding) VALUES (${document.userId}, ${JSON.stringify(embedding)})`.execute(trx);
      const vector = await sql<{ id: number }>`SELECT last_insert_rowid() AS id`.execute(trx);
      const id = Number(vector.rows[0]?.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("sqlite-vec did not return a valid rowid");

      const now = nowIso();
      await trx.insertInto("vector_items").values({
        id,
        user_id: document.userId,
        type: document.sourceType,
        outer_id: document.sourceId,
        content: document.content,
        content_hash: document.contentHash,
        status: "indexed",
        error_code: null,
        indexed_at: now,
        created_at: now,
      }).execute();
    });
  }

  async remove(ref: MemoryRef): Promise<void> {
    await this.db.transaction().execute(async trx => {
      const rows = await trx
        .selectFrom("vector_items")
        .select("id")
        .where("user_id", "=", ref.userId)
        .where("type", "=", ref.sourceType)
        .where("outer_id", "=", ref.sourceId)
        .execute();
      for (const row of rows) {
        await sql`DELETE FROM record_vectors WHERE rowid = ${Number(row.id)}`.execute(trx);
      }
      await trx
        .deleteFrom("vector_items")
        .where("user_id", "=", ref.userId)
        .where("type", "=", ref.sourceType)
        .where("outer_id", "=", ref.sourceId)
        .execute();
    });
  }

  async search(input: {
    userId: string;
    sourceType: MemorySourceType;
    embedding: number[];
    limit: number;
  }): Promise<MemoryIndexHit[]> {
    const candidates = await sql<VectorRow>`
      SELECT rowid AS id, distance
      FROM record_vectors
      WHERE embedding MATCH ${JSON.stringify(input.embedding)}
        AND user_id = ${input.userId}
        AND k = ${input.limit}
      ORDER BY distance
    `.execute(this.db);

    if (!candidates.rows.length) return [];

    const ids = candidates.rows.map(row => row.id);
    const rows = await this.db
      .selectFrom("vector_items")
      .select(["id", "user_id", "type", "outer_id", "content"])
      .where("id", "in", ids)
      .where("user_id", "=", input.userId)
      .where("type", "=", input.sourceType)
      .where("status", "=", "indexed")
      .execute();

    const byId = new Map(rows.map(row => [row.id, row]));
    return candidates.rows.flatMap(candidate => {
      const item = byId.get(candidate.id);
      if (!item) return [];
      return [{
        userId: item.user_id,
        sourceType: item.type as MemorySourceType,
        sourceId: item.outer_id,
        content: item.content,
        distance: candidate.distance,
      }];
    });
  }

  async reset(): Promise<void> {
    await this.db.transaction().execute(async trx => {
      await trx.deleteFrom("vector_items").execute();
      await sql`DROP TABLE IF EXISTS record_vectors`.execute(trx);
      await sql`CREATE VIRTUAL TABLE record_vectors USING vec0(user_id text partition key, embedding float[1536])`.execute(trx);
    });
  }
}
