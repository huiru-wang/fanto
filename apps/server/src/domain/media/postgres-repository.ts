import { type Kysely, type Transaction } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import { storedThumbnail, thumbnailObjectKey, type Thumbnail } from "./image-thumbnail.js";
import { nowIso } from "../../infrastructure/time.js";

export type MediaAsset = { mediaId: string; userId: string; objectKey: string; mediaType: "image" | "audio" | "file"; mimeType: string; bytes: number; status: "uploading" | "ready"; extData: Record<string, unknown>; createdAt: string; updatedAt: string };
export type AudioAsr = { status: "running" | "succeeded" | "failed"; model?: string; emotion?: string; language?: string; completedAt?: string; errorCode?: string };
const json = (value: string | null): Record<string, unknown> => value ? JSON.parse(value) : {};
const asset = (row: any): MediaAsset => ({ mediaId: row.media_id, userId: row.user_id, objectKey: row.object_key, mediaType: row.media_type, mimeType: row.mime_type, bytes: row.bytes, status: row.status, extData: json(row.ext_data), createdAt: row.created_at, updatedAt: row.updated_at });

export class PostgresMediaRepository {
  constructor(private db: Kysely<DB>) {}

  static async enqueueRecordDeletion(userId: string, ids: string[], transaction: Transaction<DB>) {
    if (!ids.length) return [];
    const assets = await transaction.selectFrom("media_assets").selectAll().where("user_id", "=", userId).where("media_id", "in", ids).orderBy("media_id").forUpdate().execute();
    const keys:string[]=[];
    for (const row of assets) {
      keys.push(row.object_key);
      if (row.media_type === "image") keys.push(storedThumbnail(json(row.ext_data), row.object_key)?.objectKey ?? thumbnailObjectKey(row.object_key));
      await transaction.deleteFrom("media_assets").where("media_id", "=", row.media_id).where("user_id", "=", userId).execute();
    }
    return [...new Set(keys)];
  }

  async create(input: { mediaId: string; userId: string; objectKey: string; mediaType: "image" | "audio"; mimeType: string; bytes: number; purpose?: "record" | "fanto_avatar" | "user_avatar" | "user_cover" }) {
    const now = nowIso();
    const row = { media_id: input.mediaId, user_id: input.userId, object_key: input.objectKey, media_type: input.mediaType, mime_type: input.mimeType, bytes: input.bytes, status: "uploading", ext_data: JSON.stringify({ recordId: null, capture: {}, ...(input.purpose ? {purpose:input.purpose} : {}) }), created_at: now, updated_at: now };
    await this.db.insertInto("media_assets").values(row).execute();
    return asset(row);
  }

  async createReadyAsset(input: { mediaId: string; userId: string; objectKey: string; mediaType: "image" | "audio" | "file"; mimeType: string; bytes: number; extData: Record<string, unknown> }, transaction: Transaction<DB> | Kysely<DB> = this.db) {
    const now = nowIso();
    const row = await transaction.insertInto("media_assets").values({ media_id: input.mediaId, user_id: input.userId, object_key: input.objectKey, media_type: input.mediaType, mime_type: input.mimeType, bytes: input.bytes, status: "ready", ext_data: JSON.stringify(input.extData), created_at: now, updated_at: now }).returningAll().executeTakeFirstOrThrow();
    return asset(row);
  }
  async createReadyImage(input: { mediaId: string; userId: string; objectKey: string; mimeType: string; bytes: number; extData: Record<string, unknown> }) {
    return this.createReadyAsset({ ...input, mediaType: "image" });
  }

  async complete(id: string, userId: string, capture: Record<string, unknown>, thumbnail?: Thumbnail) {
    return this.db.transaction().execute(async trx => {
      const row = await trx.selectFrom("media_assets").selectAll().where("media_id", "=", id).where("user_id", "=", userId).forUpdate().executeTakeFirst();
      if (!row) return null;
      if (json(row.ext_data).cleanupClaimedAt || json(row.ext_data).retiredAt) return null;
      if (row.status === "ready") return asset(row);
      if (row.status !== "uploading") return null;
      const updated = await trx.updateTable("media_assets").set({ status: "ready", ext_data: JSON.stringify({ ...json(row.ext_data), capture, ...(thumbnail ? { variants: { ...(json(row.ext_data).variants as object ?? {}), thumbnail } } : {}) }), updated_at: nowIso() }).where("media_id", "=", id).where("user_id", "=", userId).where("status", "=", "uploading").returningAll().executeTakeFirst();
      return updated ? asset(updated) : null;
    });
  }

  async saveThumbnail(id: string, userId: string, thumbnail: Thumbnail) {
    return this.db.transaction().execute(async trx => {
      const row = await trx.selectFrom("media_assets").selectAll().where("media_id", "=", id).where("user_id", "=", userId).forUpdate().executeTakeFirst();
      if (!row || row.status !== "ready") return null;
      const data = json(row.ext_data);
      const existing = storedThumbnail(data, row.object_key);
      if (existing) return asset(row);
      const updated = await trx.updateTable("media_assets").set({ ext_data: JSON.stringify({ ...data, variants: { ...(data.variants as object ?? {}), thumbnail } }), updated_at: nowIso() })
        .where("media_id", "=", id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
      return asset(updated);
    });
  }

  async findMedia(id: string, userId: string) { const row = await this.db.selectFrom("media_assets").selectAll().where("media_id", "=", id).where("user_id", "=", userId).executeTakeFirst(); return row ? asset(row) : null; }
  async findMediaByIds(ids: string[], userId: string, database: Kysely<DB> = this.db, lock = false) { if (!ids.length) return []; const q = database.selectFrom("media_assets").selectAll().where("user_id", "=", userId).where("media_id", "in", ids).orderBy("media_id"); return (await (lock ? q.forShare() : q).execute()).map(asset); }
}
