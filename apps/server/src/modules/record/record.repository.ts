import type { Record } from "./record.js";
import type { SaveRecordContent } from "../../domain/record-content.js";
export interface RecordRepository {
  create(input: { userId: string; source?: string; value: SaveRecordContent }): Promise<Record | "invalid_media" | "invalid_content">;
  findById(id: string): Promise<Record | null>;
  findByUserId(userId: string, opts: { cursor?: string; limit: number }): Promise<Record[]>;
  updateContent(id: string, userId: string, input: { value: SaveRecordContent; expectedVersion: number }): Promise<Record | "not_found" | "conflict" | "invalid_media" | "invalid_content">;
  writeImageDescription(input: { recordId: string; userId: string; mediaId: string; version: number; description: string }): Promise<boolean>;
}
