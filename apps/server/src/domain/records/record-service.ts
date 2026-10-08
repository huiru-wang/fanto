import { ProjectService } from "../projects/index.js";
import { MediaService } from "../media/index.js";
import { parseSaveRecord } from "./content.js";
import { decodeRecordCursor, encodeRecordCursor } from "./cursor.js";
import type { RecordReadOptions, RecordRepository, RecordSavedHook } from "./repository.js";
import { PostgresRecordRepository } from "./postgres-repository.js";
import type { RecordPostprocessQueue } from "../../infrastructure/queue/record-postprocess-queue.js";
import type { RecordRetrievalService } from "./retrieval/record-retrieval-service.js";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { Record } from "./record.js";

type RecordRetrieval = Pick<RecordRetrievalService, "searchRecords">;
type RecordListCacheValue = { records: Record[]; hasMoreAfterTopTen: boolean };
type RecordListCache = {
  getOrLoad(key: string, loader: () => Promise<RecordListCacheValue>): Promise<RecordListCacheValue>;
  delete(key: string): void;
};

const RECORD_LIST_CACHE_SIZE = 10;

export class RecordService {
  constructor(
    private readonly records: RecordRepository,
    private readonly queue: RecordPostprocessQueue,
    private readonly retrieval?: RecordRetrieval,
    private readonly listCache?: RecordListCache,
  ) {}

  static create(db: Kysely<DB>, queue: RecordPostprocessQueue, retrieval?: RecordRetrieval, listCache?: RecordListCache, onSaved?: RecordSavedHook) {
    return new RecordService(new PostgresRecordRepository(db, ProjectService.removeRecordReferences, onSaved, (userId, ids, transaction) => MediaService.enqueueRecordDeletion(userId, ids, transaction)), queue, retrieval, listCache);
  }

  async create(userId: string, input: { text: string; media: unknown[]; location?: unknown; source?: string; eventAt: string }) {
    const record = await this.records.create({ userId, source: input.source, eventAt: new Date(input.eventAt).toISOString(), value: parseSaveRecord({ text: input.text, media: input.media, location: input.location }) });
    if (typeof record === "string") return { kind: record } as const;
    this.invalidateList(record.userId);
    this.queue.publish({ userId: record.userId, recordId: record.id, version: record.version });
    return { kind: "ok", record: this.view(record) } as const;
  }

  async update(userId: string, id: string, input: { text: string; media: unknown[]; location?: unknown; expectedVersion: number }) {
    const current = await this.records.findById(id);
    if (!current || current.userId !== userId) return { kind: "not_found" } as const;
    const existing = current.content.blocks.find(block => block.type === "location");
    const location = input.location === undefined && existing
      ? { name: existing.name, latitude: existing.latitude, longitude: existing.longitude }
      : input.location;
    const record = await this.records.updateContent(id, userId, { value: parseSaveRecord({ text: input.text, media: input.media, location }), expectedVersion: input.expectedVersion });
    if (record === "conflict") return { kind: "conflict", current: await this.find(userId, id) } as const;
    if (typeof record === "string") return { kind: record } as const;
    this.invalidateList(record.userId);
    this.queue.publish({ userId: record.userId, recordId: record.id, version: record.version });
    return { kind: "ok", record: this.view(record) } as const;
  }

  async delete(userId: string, id: string, expectedVersion: number) {
    const current = await this.records.findById(id);
    if (!current || current.userId !== userId) return { kind: "not_found" } as const;
    if (current.version !== expectedVersion) return { kind: "conflict", current: this.view(current) } as const;
    const deleted = await this.records.delete(id, userId, expectedVersion);
    if (deleted === "conflict") return { kind: "conflict", current: await this.find(userId, id) } as const;
    if (typeof deleted === "string") return { kind: deleted } as const;
    this.invalidateList(userId);
    return { kind: "ok", recordId: id } as const;
  }

  async list(userId: string, cursor: string | undefined, limit: number) {
    if (cursor) {
      decodeRecordCursor(cursor);
      return this.readPage(userId, cursor, limit);
    }
    if (!this.listCache || limit > RECORD_LIST_CACHE_SIZE) return this.readPage(userId, undefined, limit);

    const cached = await this.listCache.getOrLoad(userId, async () => {
      const rows = await this.records.findByUserId(userId, { limit: RECORD_LIST_CACHE_SIZE + 1 });
      return {
        records: rows.slice(0, RECORD_LIST_CACHE_SIZE),
        hasMoreAfterTopTen: rows.length > RECORD_LIST_CACHE_SIZE,
      };
    });
    return this.pageFromCached(cached, limit);
  }

  async search(userId: string, query: string, limit: number) {
    if (!this.retrieval) return [];
    return this.retrieval.searchRecords({ userId, query, limit });
  }

  async find(userId: string, id: string) {
    const record = await this.records.findById(id);
    return record && record.userId === userId ? this.view(record) : null;
  }

  async findMany(userId: string, ids: string[], options?: RecordReadOptions) {
    if (!ids.length) return [];
    const rows = await this.records.findByIds(userId, [...new Set(ids)], options);
    const byId = new Map(rows.map(record => [record.id, this.view(record)]));
    return ids.flatMap(id => { const record = byId.get(id); return record ? [record] : []; });
  }

  async ensurePostprocess(userId: string, recordId: string, version: number) {
    const record = await this.records.findById(recordId);
    if (!record || record.userId !== userId || record.version !== version) return;
    if (record.status === "processing" && record.taskId && Date.parse(record.updatedAt) < Date.now() - 10 * 60_000) {
      await this.releasePostprocess({ userId, recordId, version, runId: record.taskId });
    } else if (!["pending", "updated"].includes(record.status)) return;
    this.queue.publish({ userId, recordId, version });
  }

  async claimPostprocess(input: { recordId: string; userId: string; version: number; runId: string }) {
    const record = await this.records.claimPostprocess(input);
    if (record) this.invalidateList(input.userId);
    return record;
  }

  async completePostprocess(input: { recordId: string; userId: string; version: number; runId: string; images: Array<{ mediaId: string; description: string }>; audio: Array<{ mediaId: string; transcription?: string; asr: { status: "succeeded" | "failed"; model?: string; emotion?: string; language?: string; completedAt?: string; errorCode?: string } }> }) {
    const record = await this.records.completePostprocess(input);
    if (record) this.invalidateList(input.userId);
    return record;
  }

  async releasePostprocess(input: { recordId: string; userId: string; version: number; runId: string }) {
    await this.records.releasePostprocess(input);
    this.invalidateList(input.userId);
  }

  private async readPage(userId: string, cursor: string | undefined, limit: number) {
    const rows = await this.records.findByUserId(userId, { cursor, limit: limit + 1 });
    const data = rows.slice(0, limit).map(record => this.view(record));
    const hasMore = rows.length > limit;
    return { data, hasMore, nextCursor: hasMore && data.at(-1) ? encodeRecordCursor(data.at(-1)!) : null, pageSize: limit };
  }

  private pageFromCached(cached: RecordListCacheValue, limit: number) {
    const data = cached.records.slice(0, limit).map(record => this.view(record));
    const hasMore = cached.records.length > limit || cached.hasMoreAfterTopTen;
    return { data, hasMore, nextCursor: hasMore && data.at(-1) ? encodeRecordCursor(data.at(-1)!) : null, pageSize: limit };
  }

  private invalidateList(userId: string) {
    this.listCache?.delete(userId);
  }

  private view(record: Record) {
    const { taskId: _taskId, ...safeRecord } = record;
    return safeRecord;
  }
}
