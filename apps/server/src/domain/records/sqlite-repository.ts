import { sql, type Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import type { DB } from "../../infrastructure/database/schema.js";
import type { RecordRepository } from "./repository.js";
import type { Record } from "./record.js";
import type { RecordContent } from "@fanto/shared";
import type { SaveRecordContent } from "./content.js";
import { nowIso } from "../../infrastructure/time.js";
import { decodeRecordCursor } from "./cursor.js";

type ExtData = { recordId?: string | null; capture?: { width?: number | null; height?: number | null; durationMs?: number | null } };
const ext = (value: string | null): ExtData => value ? JSON.parse(value) as ExtData : {};

export class SqliteRecordRepository implements RecordRepository {
  constructor(private db: Kysely<DB>) {}

  async create(input: { userId: string; source?: string; eventAt: string; value: SaveRecordContent }): Promise<Record | "invalid_media" | "invalid_content"> {
    return this.db.transaction().execute(async trx => {
      const blocks = await this.blocks(trx, input.userId, input.value);
      if (typeof blocks === "string") return blocks;
      const now = nowIso();
      const row = { record_id: randomUUID(), user_id: input.userId, source: input.source ?? "home", content: JSON.stringify({ text: input.value.text, blocks }), version: 1, status: "pending", task_id: null, event_at: input.eventAt, created_at: now, updated_at: now };
      await trx.insertInto("records").values(row).execute();
      await this.link(trx, input.userId, input.value.media.map(item => item.mediaId), row.record_id);
      return this.toEntity(row);
    });
  }

  async findById(id: string) { const row = await this.db.selectFrom("records").selectAll().where("record_id", "=", id).executeTakeFirst(); return row ? this.toEntity(row) : null; }

  async findByUserId(userId: string, opts: { cursor?: string; limit: number }) {
    let query = this.db.selectFrom("records").selectAll().where("user_id", "=", userId);
    if (opts.cursor) {
      const cursor = decodeRecordCursor(opts.cursor);
      query = query.where(eb => eb.or([eb("event_at", "<", cursor.eventAt), eb.and([eb("event_at", "=", cursor.eventAt), eb("record_id", "<", cursor.id!)]) ]));
    }
    return (await query.orderBy("event_at", "desc").orderBy("record_id", "desc").limit(opts.limit).execute()).map(row => this.toEntity(row));
  }

  async updateContent(id: string, userId: string, input: { value: SaveRecordContent; expectedVersion: number }): Promise<Record | "not_found" | "conflict" | "invalid_media" | "invalid_content"> {
    return this.db.transaction().execute(async trx => {
      const previous = await trx.selectFrom("records").selectAll().where("record_id", "=", id).where("user_id", "=", userId).executeTakeFirst();
      if (!previous) return "not_found";
      if (previous.version !== input.expectedVersion) return "conflict";
      if (previous.status === "processing") return "conflict";
      const blocks = await this.blocks(trx, userId, input.value, id);
      if (typeof blocks === "string") return blocks;
      const oldIds = (JSON.parse(previous.content) as RecordContent).blocks.map(block => block.mediaId);
      const newIds = input.value.media.map(item => item.mediaId);
      const now = nowIso();
      const row = await trx.updateTable("records").set({ content: JSON.stringify({ text: input.value.text, blocks }), version: sql<number>`version + 1`, status: "updated", task_id: null, updated_at: now }).where("record_id", "=", id).returningAll().executeTakeFirstOrThrow();
      await this.link(trx, userId, newIds, id);
      for (const mediaId of oldIds.filter(mediaId => !newIds.includes(mediaId))) await this.unlink(trx, userId, mediaId, now);
      return this.toEntity(row);
    });
  }

  async claimPostprocess(input: { recordId: string; userId: string; version: number; runId: string }) {
    const row = await this.db.updateTable("records").set({ status: "processing", task_id: input.runId, updated_at: nowIso() }).where("record_id", "=", input.recordId).where("user_id", "=", input.userId).where("version", "=", input.version).where("status", "in", ["pending", "updated"]).returningAll().executeTakeFirst();
    return row ? this.toEntity(row) : null;
  }

  async completePostprocess(input: { recordId: string; userId: string; version: number; runId: string; images: Array<{ mediaId: string; description: string }>; audio: Array<{ mediaId: string; transcription?: string; asr: { status: "succeeded" | "failed"; model?: string; emotion?: string; language?: string; completedAt?: string; errorCode?: string } }> }) {
    return this.db.transaction().execute(async trx => {
      const row = await trx.selectFrom("records").selectAll().where("record_id", "=", input.recordId).where("user_id", "=", input.userId).where("version", "=", input.version).where("status", "=", "processing").where("task_id", "=", input.runId).executeTakeFirst();
      if (!row) return false;
      const content = JSON.parse(row.content) as RecordContent;
      const images = new Map(input.images.map(item => [item.mediaId, item.description]));
      const audio = new Map(input.audio.map(item => [item.mediaId, item]));
      content.blocks = content.blocks.map(block => {
        if (block.type === "image") return images.has(block.mediaId) ? { ...block, description: images.get(block.mediaId) } : block;
        const result = audio.get(block.mediaId);
        return result?.transcription ? { ...block, transcription: result.transcription } : block;
      });
      const now = nowIso();
      for (const result of input.audio) {
        const media = await trx.selectFrom("media_assets").selectAll().where("media_id", "=", result.mediaId).where("user_id", "=", input.userId).where("media_type", "=", "audio").executeTakeFirst();
        if (!media || ext(media.ext_data).recordId !== input.recordId) continue;
        await trx.updateTable("media_assets").set({ ext_data: JSON.stringify({ ...ext(media.ext_data), asr: result.asr }), updated_at: now }).where("media_id", "=", result.mediaId).where("user_id", "=", input.userId).execute();
      }
      const updated = await trx.updateTable("records").set({ content: JSON.stringify(content), status: "processed", task_id: null, updated_at: now }).where("record_id", "=", input.recordId).where("user_id", "=", input.userId).where("version", "=", input.version).where("status", "=", "processing").where("task_id", "=", input.runId).executeTakeFirst();
      return updated.numUpdatedRows === 1n;
    });
  }

  async releasePostprocess(input: { recordId: string; userId: string; version: number; runId: string }): Promise<void> {
    await this.db.updateTable("records").set({ status: "pending", task_id: null, updated_at: nowIso() }).where("record_id", "=", input.recordId).where("user_id", "=", input.userId).where("version", "=", input.version).where("status", "=", "processing").where("task_id", "=", input.runId).execute();
  }

  private async blocks(trx: Kysely<DB>, userId: string, value: SaveRecordContent, recordId?: string): Promise<RecordContent["blocks"] | "invalid_media" | "invalid_content"> {
    const ids = value.media.map(item => item.mediaId);
    const assets = ids.length ? await trx.selectFrom("media_assets").selectAll().where("user_id", "=", userId).where("media_id", "in", ids).execute() : [];
    if (assets.length !== ids.length || assets.some(asset => asset.status !== "ready" || ext(asset.ext_data).recordId && ext(asset.ext_data).recordId !== recordId)) return "invalid_media";
    if (!value.text.trim() && !assets.some(asset => asset.media_type === "audio")) return "invalid_content";
    const byId = new Map(assets.map(asset => [asset.media_id, asset]));
    return value.media.map(item => byId.get(item.mediaId)!.media_type === "image" ? { type: "image", mediaId: item.mediaId } : { type: "audio", mediaId: item.mediaId });
  }

  private async link(trx: Kysely<DB>, userId: string, ids: string[], recordId: string) {
    for (const mediaId of ids) {
      const media = await trx.selectFrom("media_assets").selectAll().where("media_id", "=", mediaId).where("user_id", "=", userId).executeTakeFirstOrThrow();
      await trx.updateTable("media_assets").set({ ext_data: JSON.stringify({ ...ext(media.ext_data), recordId }), updated_at: nowIso() }).where("media_id", "=", mediaId).execute();
    }
  }

  private async unlink(trx: Kysely<DB>, userId: string, mediaId: string, now: string) {
    const media = await trx.selectFrom("media_assets").selectAll().where("media_id", "=", mediaId).where("user_id", "=", userId).executeTakeFirst();
    if (media) await trx.updateTable("media_assets").set({ ext_data: JSON.stringify({ ...ext(media.ext_data), recordId: null }), updated_at: now }).where("media_id", "=", mediaId).execute();
  }

  private toEntity(row: any): Record { return { extData: null, id: row.record_id, userId: row.user_id, source: row.source, content: JSON.parse(row.content), version: row.version, status: row.status, taskId: row.task_id, eventAt: row.event_at, createdAt: row.created_at, updatedAt: row.updated_at }; }
}
