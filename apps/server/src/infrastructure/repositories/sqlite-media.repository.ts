import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../schema.js";
import { nowIso } from "../time.js";

export type MediaAsset = { mediaId: string; userId: string; objectKey: string; mediaType: "image" | "audio"; mimeType: string; bytes: number; status: "uploading" | "ready"; extData: Record<string, unknown>; createdAt: string; updatedAt: string };
const json = (value: string | null): Record<string, unknown> => value ? JSON.parse(value) : {};
const asset = (row: any): MediaAsset => ({ mediaId: row.media_id, userId: row.user_id, objectKey: row.object_key, mediaType: row.media_type, mimeType: row.mime_type, bytes: row.bytes, status: row.status, extData: json(row.ext_data), createdAt: row.created_at, updatedAt: row.updated_at });

export class SqliteMediaRepository {
  constructor(private db: Kysely<DB>) {}

  async create(input: { userId: string; objectKey: string; mediaType: "image" | "audio"; mimeType: string; bytes: number }) {
    const now = nowIso();
    const row = { media_id: randomUUID(), user_id: input.userId, object_key: input.objectKey, media_type: input.mediaType, mime_type: input.mimeType, bytes: input.bytes, status: "uploading", ext_data: JSON.stringify({ recordId: null, capture: {} }), created_at: now, updated_at: now };
    await this.db.insertInto("media_assets").values(row).execute();
    return asset(row);
  }

  async complete(id: string, userId: string, capture: Record<string, unknown>) {
    return this.db.transaction().execute(async trx => {
      const row = await trx.selectFrom("media_assets").selectAll().where("media_id", "=", id).where("user_id", "=", userId).executeTakeFirst();
      if (!row) return null;
      if (row.status === "ready") return asset(row);
      if (row.status !== "uploading") return null;
      const updated = await trx.updateTable("media_assets").set({ status: "ready", ext_data: JSON.stringify({ ...json(row.ext_data), capture }), updated_at: nowIso() }).where("media_id", "=", id).where("status", "=", "uploading").returningAll().executeTakeFirst();
      return updated ? asset(updated) : null;
    });
  }

  async findMedia(id: string, userId: string) { const row = await this.db.selectFrom("media_assets").selectAll().where("media_id", "=", id).where("user_id", "=", userId).executeTakeFirst(); return row ? asset(row) : null; }
  async findMediaByIds(ids: string[], userId: string) { if (!ids.length) return []; return (await this.db.selectFrom("media_assets").selectAll().where("user_id", "=", userId).where("media_id", "in", ids).execute()).map(asset); }
}
