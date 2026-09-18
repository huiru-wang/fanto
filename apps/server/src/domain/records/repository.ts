import type { Record } from "./record.js";
import type { SaveRecordContent } from "./content.js";
export interface RecordRepository {
  create(input: { userId: string; source?: string; eventAt: string; value: SaveRecordContent }): Promise<Record | "invalid_media" | "invalid_content">;
  findById(id: string): Promise<Record | null>;
  findByUserId(userId: string, opts: { cursor?: string; limit: number }): Promise<Record[]>;
  updateContent(id: string, userId: string, input: { value: SaveRecordContent; expectedVersion: number }): Promise<Record | "not_found" | "conflict" | "invalid_media" | "invalid_content">;
  claimPostprocess(input: { recordId: string; userId: string; version: number; runId: string }): Promise<Record | null>;
  completePostprocess(input: { recordId: string; userId: string; version: number; runId: string; images: Array<{ mediaId: string; description: string }>; audio: Array<{ mediaId: string; transcription?: string; asr: { status: "succeeded" | "failed"; model?: string; emotion?: string; language?: string; completedAt?: string; errorCode?: string } }> }): Promise<Record | null>;
  releasePostprocess(input: { recordId: string; userId: string; version: number; runId: string }): Promise<void>;
}
