import type { Record } from "./record.js";
import type { SaveRecordContent } from "../../domain/record-content.js";
export interface RecordRepository {
  create(input: { userId: string; source?: string; value: SaveRecordContent }): Promise<Record | "audio_pending" | "invalid_media">;
  findById(id: string): Promise<Record | null>;
  findByUserId(userId: string, opts: { cursor?: string; limit: number }): Promise<Record[]>;
  updateContent(id: string, userId: string, input: { value: SaveRecordContent; expectedVersion: number }): Promise<Record | "not_found" | "conflict" | "audio_pending" | "invalid_media">;
}
