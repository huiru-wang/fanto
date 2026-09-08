import { sql, type Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import type { DB } from "../schema.js";
import type { RecordRepository } from "../../modules/record/record.repository.js";
import type { Record } from "../../modules/record/record.js";
import type { RecordContent } from "@fanto/shared";
import type { SaveRecordContent } from "../../domain/record-content.js";
import { nowIso } from "../time.js";
import { decodeRecordCursor } from "../../modules/record/record-cursor.js";

type ExtData = { recordId?: string | null; capture?: { width?: number | null; height?: number | null; durationMs?: number | null } };
const ext = (value: string | null): ExtData => value ? JSON.parse(value) as ExtData : {};

export class SqliteRecordRepository implements RecordRepository {
  constructor(private db: Kysely<DB>) {}

  async create(input: { userId: string; source?: string; value: SaveRecordContent }): Promise<Record | "invalid_media"> {
    return this.db.transaction().execute(async trx => {
      const blocks = await this.blocks(trx, input.userId, input.value);
      if (blocks === "invalid_media") return blocks;
      const now = nowIso();
      const row = { id: randomUUID(), user_id: input.userId, source: input.source ?? "home", content: JSON.stringify({ text: input.value.text, blocks }), version: 1, status: "active", created_at: now, updated_at: now };
      await trx.insertInto("records").values(row).execute();
      await this.link(trx, input.userId, input.value.media.map(item => item.mediaId), row.id);
      return this.toEntity(row);
    });
  }

  async findById(id: string) { const row = await this.db.selectFrom("records").selectAll().where("id", "=", id).executeTakeFirst(); return row ? this.toEntity(row) : null; }

  async findByUserId(userId: string, opts: { cursor?: string; limit: number }) {
    let query = this.db.selectFrom("records").selectAll().where("user_id", "=", userId);
    if (opts.cursor) {
      const cursor = decodeRecordCursor(opts.cursor);
      if (cursor.id) query = query.where(eb => eb.or([eb("created_at", "<", cursor.createdAt), eb.and([eb("created_at", "=", cursor.createdAt), eb("id", "<", cursor.id!)])]));
    }
    return (await query.orderBy("created_at", "desc").orderBy("id", "desc").limit(opts.limit).execute()).map(row => this.toEntity(row));
  }

  async updateContent(id: string, userId: string, input: { value: SaveRecordContent; expectedVersion: number }): Promise<Record | "not_found" | "conflict" | "invalid_media"> {
    return this.db.transaction().execute(async trx => {
      const previous = await trx.selectFrom("records").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
      if (!previous) return "not_found";
      if (previous.version !== input.expectedVersion) return "conflict";
      const blocks = await this.blocks(trx, userId, input.value, id);
      if (blocks === "invalid_media") return blocks;
      const oldIds = (JSON.parse(previous.content) as RecordContent).blocks.map(block => block.mediaId);
      const newIds = input.value.media.map(item => item.mediaId);
      const now = nowIso();
      const row = await trx.updateTable("records").set({ content: JSON.stringify({ text: input.value.text, blocks }), version: sql<number>`version + 1`, updated_at: now }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      await this.link(trx, userId, newIds, id);
      for (const mediaId of oldIds.filter(mediaId => !newIds.includes(mediaId))) await this.unlink(trx, userId, mediaId, now);
      return this.toEntity(row);
    });
  }

  async writeImageDescription(input: { recordId: string; userId: string; mediaId: string; version: number; description: string }) {
    return this.db.transaction().execute(async trx => {
      const row = await trx.selectFrom("records").selectAll().where("id", "=", input.recordId).where("user_id", "=", input.userId).where("version", "=", input.version).executeTakeFirst();
      if (!row) return false;
      const content = JSON.parse(row.content) as RecordContent;
      const index = content.blocks.findIndex(block => block.mediaId === input.mediaId && !("transcript" in block));
      if (index < 0) return false;
      const block = content.blocks[index] as { mediaId: string; description?: string };
      if (block.description) return false;
      content.blocks[index] = { ...block, description: input.description };
      const updated = await trx.updateTable("records").set({ content: JSON.stringify(content), updated_at: nowIso() }).where("id", "=", input.recordId).where("version", "=", input.version).executeTakeFirst();
      return updated.numUpdatedRows === 1n;
    });
  }

  private async blocks(trx: Kysely<DB>, userId: string, value: SaveRecordContent, recordId?: string): Promise<RecordContent["blocks"] | "invalid_media"> {
    const ids = value.media.map(item => item.mediaId);
    const assets = ids.length ? await trx.selectFrom("media_assets").selectAll().where("user_id", "=", userId).where("id", "in", ids).execute() : [];
    if (assets.length !== ids.length || assets.some(asset => ext(asset.ext_data).recordId && ext(asset.ext_data).recordId !== recordId)) return "invalid_media";
    const byId = new Map(assets.map(asset => [asset.id, asset]));
    return value.media.map(item => byId.get(item.mediaId)!.media_type === "image" ? { mediaId: item.mediaId } : { mediaId: item.mediaId, ...(item.transcript ? { transcript: item.transcript } : {}) });
  }

  private async link(trx: Kysely<DB>, userId: string, ids: string[], recordId: string) {
    for (const id of ids) {
      const media = await trx.selectFrom("media_assets").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirstOrThrow();
      await trx.updateTable("media_assets").set({ ext_data: JSON.stringify({ ...ext(media.ext_data), recordId }), updated_at: nowIso() }).where("id", "=", id).execute();
    }
  }

  private async unlink(trx: Kysely<DB>, userId: string, mediaId: string, now: string) {
    const media = await trx.selectFrom("media_assets").selectAll().where("id", "=", mediaId).where("user_id", "=", userId).executeTakeFirst();
    if (media) await trx.updateTable("media_assets").set({ ext_data: JSON.stringify({ ...ext(media.ext_data), recordId: null }), updated_at: now }).where("id", "=", mediaId).execute();
  }

  private toEntity(row: any): Record { return { extData: null, id: row.id, userId: row.user_id, source: row.source, content: JSON.parse(row.content), version: row.version, status: "active", createdAt: row.created_at, updatedAt: row.updated_at }; }
}
