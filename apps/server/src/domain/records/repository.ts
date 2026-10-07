import type { Transaction } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
export type RecordReadOptions = { transaction?: Transaction<DB>; lock?: boolean };
import type { Record } from "./record.js";
import type { SaveRecordContent } from "./content.js";
export interface RecordRepository {
  create(input: { userId: string; source?: string; eventAt: string; value: SaveRecordContent }): Promise<Record | "invalid_media" | "invalid_content">;
  findById(id: string): Promise<Record | null>;
  findByIds(userId: string, ids: string[], options?: RecordReadOptions): Promise<Record[]>;
  findByUserId(userId: string, opts: { cursor?: string; limit: number }): Promise<Record[]>;
  updateContent(id: string, userId: string, input: { value: SaveRecordContent; expectedVersion: number }): Promise<Record | "not_found" | "conflict" | "invalid_media" | "invalid_content">;
  delete(id: string, userId: string, expectedVersion: number): Promise<Record | "not_found" | "conflict">;
  claimPostprocess(input: { recordId: string; userId: string; version: number; runId: string }): Promise<Record | null>;
  completePostprocess(input: { recordId: string; userId: string; version: number; runId: string; images: Array<{ mediaId: string; description: string }>; audio: Array<{ mediaId: string; transcription?: string; asr: { status: "succeeded" | "failed"; model?: string; emotion?: string; language?: string; completedAt?: string; errorCode?: string } }> }): Promise<Record | null>;
  releasePostprocess(input: { recordId: string; userId: string; version: number; runId: string }): Promise<void>;
  writeEmbedding(input: { recordId: string; userId: string; version: number; embedding: number[] }): Promise<boolean>;
  searchByEmbedding(input: { userId: string; embedding: number[]; limit: number }): Promise<Array<{ record: Record; distance: number }>>;
}

export type RecordSavedHook = (userId: string, recordId: string, version: number, transaction: Transaction<DB>) => Promise<void>;
