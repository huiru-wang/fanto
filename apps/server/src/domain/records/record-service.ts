import { parseSaveRecord } from "./content.js";
import { decodeRecordCursor, encodeRecordCursor } from "./cursor.js";
import type { RecordRepository } from "./repository.js";
import { PostgresRecordRepository } from "./postgres-repository.js";
import type { MediaService } from "../media/index.js";
import type { RecordPostprocessQueue } from "../../infrastructure/queue/record-postprocess-queue.js";
import type { MemoryService } from "../memory/memory-service.js";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";

type RecordMemory = Pick<MemoryService, "searchRecords" | "removeRecord">;

export class RecordService {
  constructor(private readonly records: RecordRepository, private readonly media: MediaService, private readonly queue: RecordPostprocessQueue, private readonly memory?: RecordMemory) {}
  static create(db: Kysely<DB>, media: MediaService, queue: RecordPostprocessQueue, memory?: RecordMemory) {
    return new RecordService(new PostgresRecordRepository(db), media, queue, memory);
  }

  async create(userId: string, input: { text: string; media: unknown[]; source?: string; eventAt: string }) {
    const record = await this.records.create({ userId, source: input.source, eventAt: new Date(input.eventAt).toISOString(), value: parseSaveRecord(input) });
    if (typeof record === "string") return { kind: record } as const;
    this.queue.publish({ userId: record.userId, recordId: record.id, version: record.version });
    return { kind: "ok", record: await this.view(record) } as const;
  }

  async update(userId: string, id: string, input: { text: string; media: unknown[]; expectedVersion: number }) {
    const record = await this.records.updateContent(id, userId, { value: parseSaveRecord(input), expectedVersion: input.expectedVersion });
    if (record === "conflict") return { kind: "conflict", current: await this.find(userId, id) } as const;
    if (typeof record === "string") return { kind: record } as const;
    this.queue.publish({ userId: record.userId, recordId: record.id, version: record.version });
    return { kind: "ok", record: await this.view(record) } as const;
  }

  async delete(userId: string, id: string, expectedVersion: number) {
    const current = await this.records.findById(id);
    if (!current || current.userId !== userId) return { kind: "not_found" } as const;
    if (current.version !== expectedVersion) return { kind: "conflict", current: await this.view(current) } as const;
    if (this.memory) await this.memory.removeRecord({ userId, recordId: id });
    const deleted = await this.records.delete(id, userId, expectedVersion);
    if (deleted === "conflict") return { kind: "conflict", current: await this.find(userId, id) } as const;
    return typeof deleted === "string" ? { kind: deleted } as const : { kind: "ok", recordId: id } as const;
  }

  async list(userId: string, cursor: string | undefined, limit: number) {
    if (cursor) decodeRecordCursor(cursor);
    const rows = await this.records.findByUserId(userId, { cursor, limit: limit + 1 });
    const data = await Promise.all(rows.slice(0, limit).map(record => this.view(record)));
    return { data, hasMore: rows.length > limit, nextCursor: rows.length > limit && data.at(-1) ? encodeRecordCursor(data.at(-1)) : null, pageSize: limit };
  }

  async search(userId: string, query: string, limit: number) {
    if (!this.memory) return [];
    return this.memory.searchRecords({ userId, query, limit });
  }

  async find(userId: string, id: string) {
    const record = await this.records.findById(id);
    return record && record.userId === userId ? this.view(record) : null;
  }

  claimPostprocess(input: { recordId: string; userId: string; version: number; runId: string }) { return this.records.claimPostprocess(input); }
  completePostprocess(input: { recordId: string; userId: string; version: number; runId: string; images: Array<{ mediaId: string; description: string }>; audio: Array<{ mediaId: string; transcription?: string; asr: { status: "succeeded" | "failed"; model?: string; emotion?: string; language?: string; completedAt?: string; errorCode?: string } }> }) { return this.records.completePostprocess(input); }
  releasePostprocess(input: { recordId: string; userId: string; version: number; runId: string }) { return this.records.releasePostprocess(input); }

  private async view(record: any) {
    const assets = await this.media.findOwnedByIds(record.userId, record.content.blocks.map((block: any) => block.mediaId));
    const byId = new Map(assets.map(asset => [asset.mediaId, asset]));
    const { taskId: _taskId, ...safeRecord } = record;
    return { ...safeRecord, media: record.content.blocks.flatMap((block: any) => {
      const asset = byId.get(block.mediaId); if (!asset) return [];
      const capture = asset.extData.capture as { durationMs?: number | null } | undefined;
      const asr = asset.extData.asr as { status?: string; model?: string; emotion?: string; language?: string; completedAt?: string; errorCode?: string } | undefined;
      return [block.type === "image" ? { mediaId: asset.mediaId, type: "image", url: `/api/media/${asset.mediaId}`, description: block.description ?? null } : { mediaId: asset.mediaId, type: "audio", url: `/api/media/${asset.mediaId}`, durationMs: capture?.durationMs ?? null, asr: asr ? { status: asr.status ?? "failed", transcript: block.transcription ?? null, model: asr.model ?? null, emotion: asr.emotion ?? null, language: asr.language ?? null, completedAt: asr.completedAt ?? null, errorCode: asr.errorCode ?? null } : null }];
    }) };
  }
}
