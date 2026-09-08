import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../schema.js";
import { nowIso } from "../time.js";

export type MediaAsset = { id: string; userId: string; objectKey: string; mediaType: "image" | "audio"; mimeType: string; bytes: number; extData: Record<string, unknown>; createdAt: string; updatedAt: string };
const json = (value: string | null): Record<string, unknown> => value ? JSON.parse(value) : {};
const asset = (row: any): MediaAsset => ({ id: row.id, userId: row.user_id, objectKey: row.object_key, mediaType: row.media_type, mimeType: row.mime_type, bytes: row.bytes, extData: json(row.ext_data), createdAt: row.created_at, updatedAt: row.updated_at });

export class SqliteMediaRepository {
  constructor(private db: Kysely<DB>) {}
  async createIntent(input: { userId: string; objectKey: string; mediaType: "image" | "audio"; mimeType: string; bytes: number; expiresAt: string }) { const now = nowIso(); const row = { id: randomUUID(), user_id: input.userId, object_key: input.objectKey, media_type: input.mediaType, mime_type: input.mimeType, bytes: input.bytes, status: "pending", media_id: null, ext_data: null, expires_at: input.expiresAt, created_at: now, updated_at: now }; await this.db.insertInto("upload_intents").values(row).execute(); return row; }
  async getIntent(id: string, userId: string) { return this.db.selectFrom("upload_intents").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirst(); }
  async completeIntent(id: string, userId: string, capture: Record<string, unknown>) { return this.db.transaction().execute(async trx => { const intent = await trx.selectFrom("upload_intents").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirst(); if (!intent || intent.expires_at < nowIso()) return null; if (intent.media_id) return { mediaId: intent.media_id, mediaType: intent.media_type, mimeType: intent.mime_type, bytes: intent.bytes }; if (intent.status !== "pending") return null; const now = nowIso(); const mediaId = randomUUID(); const extData = { recordId: null, capture }; await trx.insertInto("media_assets").values({ id: mediaId, user_id: userId, object_key: intent.object_key, media_type: intent.media_type, mime_type: intent.mime_type, bytes: intent.bytes, ext_data: JSON.stringify(extData), created_at: now, updated_at: now }).execute(); await trx.updateTable("upload_intents").set({ status: "completed", media_id: mediaId, ext_data: JSON.stringify(extData), updated_at: now }).where("id", "=", id).execute(); return { mediaId, mediaType: intent.media_type, mimeType: intent.mime_type, bytes: intent.bytes }; }); }
  async findMedia(id: string, userId: string) { const row = await this.db.selectFrom("media_assets").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirst(); return row ? asset(row) : null; }
  async findMediaByIds(ids: string[], userId: string) { if (!ids.length) return []; return (await this.db.selectFrom("media_assets").selectAll().where("user_id", "=", userId).where("id", "in", ids).execute()).map(asset); }
  async expired(now = nowIso()) { return this.db.selectFrom("upload_intents").selectAll().where("expires_at", "<", now).execute(); }
}
