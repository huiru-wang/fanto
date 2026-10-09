import { sql, type Transaction, type Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import type { DB } from "../../infrastructure/database/schema.js";
import type { RecordReadOptions, RecordRepository, RecordSavedHook } from "./repository.js";
import type { Record } from "./record.js";
import type { AudioContentBlock, ImageContentBlock, RecordContent } from "@fanto/shared";
import type { SaveRecordContent } from "./content.js";
import { nowIso } from "../../infrastructure/time.js";
import { decodeRecordCursor } from "./cursor.js";

type ExtData = { recordId?: string | null; capture?: { width?: number | null; height?: number | null; durationMs?: number | null } };
const ext = (value: string | null): ExtData => value ? JSON.parse(value) as ExtData : {};
const vectorLiteral = (embedding: number[]) => JSON.stringify(embedding);

export class PostgresRecordRepository implements RecordRepository {
  constructor(private db: Kysely<DB>, private readonly cleanupLinks: (userId: string, recordId: string, transaction: Transaction<DB>) => Promise<void>, private readonly onSaved?: RecordSavedHook, private readonly cleanupMedia?: (userId: string, ids: string[], transaction: Transaction<DB>) => Promise<string[]>) {}

  async create(input: { userId: string; source?: string; eventAt: string; value: SaveRecordContent }): Promise<Record | "invalid_media" | "invalid_content"> {
    return this.db.transaction().execute(async trx => {
      const blocks = await this.blocks(trx, input.userId, input.value);
      if (typeof blocks === "string") return blocks;
      const now = nowIso();
      const location = input.value.location ? normalizedLocation(input.value.location) : null;
      const row = { record_id: randomUUID(), user_id: input.userId, source: input.source ?? "home", content: JSON.stringify({ text: input.value.text, blocks }), version: 1, status: "pending", task_id: null, location_latitude: location?.latitude ?? null, location_longitude: location?.longitude ?? null, event_at: input.eventAt, created_at: now, updated_at: now, embedding: null };
      await trx.insertInto("records").values(row).execute();
      await this.link(trx, input.userId, input.value.media.map(item => item.mediaId), row.record_id);
      await this.onSaved?.(input.userId, row.record_id, row.version, trx);
      return this.toEntity(row);
    });
  }

  async findById(id: string) { const row = await this.db.selectFrom("records").selectAll().where("record_id", "=", id).executeTakeFirst(); return row ? this.toEntity(row) : null; }

  async findByIds(userId: string, ids: string[], options: RecordReadOptions = {}) {
    if (!ids.length) return [];
    const query = (options.transaction ?? this.db).selectFrom("records").selectAll().where("user_id", "=", userId).where("record_id", "in", ids).orderBy("record_id");
    if (options.lock && !options.transaction) throw new Error("Record locks require a transaction");
    return (await (options.lock ? query.forUpdate() : query).execute()).map(row => this.toEntity(row));
  }

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
      const previous = await trx.selectFrom("records").selectAll().where("record_id", "=", id).where("user_id", "=", userId).forUpdate().executeTakeFirst();
      if (!previous) return "not_found";
      if (previous.version !== input.expectedVersion) return "conflict";
      if (previous.status === "processing") return "conflict";
      const blocks = await this.blocks(trx, userId, input.value, id);
      if (typeof blocks === "string") return blocks;
      const oldIds = (JSON.parse(previous.content) as RecordContent).blocks.flatMap(block => block.type === "location" ? [] : [block.mediaId]);
      const newIds = input.value.media.map(item => item.mediaId);
      const now = nowIso();
      const location = input.value.location ? normalizedLocation(input.value.location) : null;
      const row = await trx.updateTable("records").set({ content: JSON.stringify({ text: input.value.text, blocks }), location_latitude: location?.latitude ?? null, location_longitude: location?.longitude ?? null, version: sql<number>`version + 1`, status: "updated", task_id: null, updated_at: now, embedding: null }).where("record_id", "=", id).returningAll().executeTakeFirstOrThrow();
      await this.link(trx, userId, newIds, id);
      for (const mediaId of oldIds.filter(mediaId => !newIds.includes(mediaId))) await this.unlink(trx, userId, mediaId, now);
      await this.onSaved?.(userId, row.record_id, row.version, trx);
      return this.toEntity(row);
    });
  }

  async delete(id: string, userId: string, expectedVersion: number): Promise<{record:Record;objectKeys:string[]} | "not_found" | "conflict"> {
    return this.db.transaction().execute(async trx => {
      const row = await trx.selectFrom("records").selectAll().where("record_id", "=", id).where("user_id", "=", userId).forUpdate().executeTakeFirst();
      if (!row) return "not_found";
      if (row.version !== expectedVersion) return "conflict";
      const record = this.toEntity(row);
      await this.cleanupLinks(userId, id, trx);
      const ids = record.content.blocks.flatMap(block => block.type === "location" ? [] : [block.mediaId]);
      const objectKeys=this.cleanupMedia ? await this.cleanupMedia(userId,ids,trx) : [];
      if(!this.cleanupMedia)for (const mediaId of ids) await this.unlink(trx, userId, mediaId, nowIso());
      await trx.deleteFrom("records").where("record_id", "=", id).where("user_id", "=", userId).where("version", "=", expectedVersion).execute();
      return {record,objectKeys};
    });
  }

  async claimPostprocess(input: { recordId: string; userId: string; version: number; runId: string }) {
    const row = await this.db.updateTable("records").set({ status: "processing", task_id: input.runId, updated_at: nowIso() }).where("record_id", "=", input.recordId).where("user_id", "=", input.userId).where("version", "=", input.version).where("status", "in", ["pending", "updated"]).returningAll().executeTakeFirst();
    return row ? this.toEntity(row) : null;
  }

  async completePostprocess(input: { recordId: string; userId: string; version: number; runId: string; images: Array<{ mediaId: string; description: string }>; audio: Array<{ mediaId: string; transcription?: string; asr: { status: "succeeded" | "failed"; model?: string; emotion?: string; language?: string; completedAt?: string; errorCode?: string } }> }) {
    return this.db.transaction().execute(async trx => {
      const row = await trx.selectFrom("records").selectAll().where("record_id", "=", input.recordId).where("user_id", "=", input.userId).where("version", "=", input.version).where("status", "=", "processing").where("task_id", "=", input.runId).executeTakeFirst();
      if (!row) return null;
      const content = JSON.parse(row.content) as RecordContent;
      const images = new Map(input.images.map(item => [item.mediaId, item.description]));
      const audio = new Map(input.audio.map(item => [item.mediaId, item]));
      content.blocks = content.blocks.map(block => {
        if (block.type === "image") return images.has(block.mediaId) ? { ...block, description: images.get(block.mediaId) } : block;
        if (block.type === "location") return block;
        const result = audio.get(block.mediaId);
        if (!result) return block;
        return {
          ...block,
          ...(result.transcription !== undefined ? { transcription: result.transcription } : {}),
          asr: result.asr,
        };
      });
      const now = nowIso();
      const updated = await trx.updateTable("records").set({ content: JSON.stringify(content), status: "processed", task_id: null, updated_at: now }).where("record_id", "=", input.recordId).where("user_id", "=", input.userId).where("version", "=", input.version).where("status", "=", "processing").where("task_id", "=", input.runId).returningAll().executeTakeFirst();
      return updated ? this.toEntity(updated) : null;
    });
  }

  async releasePostprocess(input: { recordId: string; userId: string; version: number; runId: string }): Promise<void> {
    await this.db.updateTable("records").set({ status: "pending", task_id: null, updated_at: nowIso() }).where("record_id", "=", input.recordId).where("user_id", "=", input.userId).where("version", "=", input.version).where("status", "=", "processing").where("task_id", "=", input.runId).execute();
  }

  async writeEmbedding(input: { recordId: string; userId: string; version: number; embedding: number[] }): Promise<boolean> {
    const result = await sql`UPDATE records SET embedding = ${vectorLiteral(input.embedding)}::vector
      WHERE record_id = ${input.recordId} AND user_id = ${input.userId}
        AND version = ${input.version} AND status = 'processed'`.execute(this.db);
    return Number(result.numUpdatedOrDeletedRows) === 1;
  }

  async searchByEmbedding(input: { userId: string; embedding: number[]; limit: number }): Promise<Array<{ record: Record; distance: number }>> {
    const rows = await sql<any>`SELECT *, (embedding <-> ${vectorLiteral(input.embedding)}::vector)::float8 AS distance
      FROM records WHERE user_id = ${input.userId} AND status = 'processed' AND embedding IS NOT NULL
      ORDER BY embedding <-> ${vectorLiteral(input.embedding)}::vector LIMIT ${input.limit}`.execute(this.db);
    return rows.rows.map(row => ({ record: this.toEntity(row), distance: Number(row.distance) }));
  }

  private async blocks(trx: Kysely<DB>, userId: string, value: SaveRecordContent, recordId?: string): Promise<RecordContent["blocks"] | "invalid_media" | "invalid_content"> {
    const ids = value.media.map(item => item.mediaId);
    const assets = ids.length ? await trx.selectFrom("media_assets").selectAll().where("user_id", "=", userId).where("media_id", "in", ids).orderBy("media_id").forUpdate().execute() : [];
    if (assets.length !== ids.length || assets.some(asset => asset.status !== "ready" || ext(asset.ext_data).recordId && ext(asset.ext_data).recordId !== recordId)) return "invalid_media";
    const byId = new Map(assets.map(asset => [asset.media_id, asset]));
    const mediaBlocks: Array<ImageContentBlock | AudioContentBlock> = value.media.map(item => {
      const asset = byId.get(item.mediaId)!;
      if (asset.media_type === "image") return { type: "image" as const, mediaId: item.mediaId };
      const durationMs = ext(asset.ext_data).capture?.durationMs;
      return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
        ? { type: "audio" as const, mediaId: item.mediaId, durationMs }
        : { type: "audio" as const, mediaId: item.mediaId };
    });
    return value.location ? [...mediaBlocks, { type: "location" as const, ...normalizedLocation(value.location) }] : mediaBlocks;
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

function normalizedLocation(location: { name: string; countryCode?: string; country?: string; province?: string; city?: string; district?: string; latitude: number; longitude: number }) {
  return {
    name: location.name.trim(),
    ...(location.countryCode?.trim() ? { countryCode: location.countryCode.trim().toUpperCase() } : {}),
    ...(location.country?.trim() ? { country: location.country.trim() } : {}),
    ...(location.province?.trim() ? { province: location.province.trim() } : {}),
    ...(location.city?.trim() ? { city: location.city.trim() } : {}),
    ...(location.district?.trim() ? { district: location.district.trim() } : {}),
    latitude: Number(location.latitude.toFixed(6)),
    longitude: Number(location.longitude.toFixed(6)),
  };
}
