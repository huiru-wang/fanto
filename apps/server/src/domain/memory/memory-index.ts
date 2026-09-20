import type { MemoryDocument, MemoryIndexHit, MemoryRef, MemorySourceType } from "./model.js";

export interface MemoryIndex {
  isCurrent(ref: MemoryRef, contentHash: string, eventAt: string): Promise<boolean>;
  replace(document: MemoryDocument, embedding: number[]): Promise<void>;
  remove(ref: MemoryRef): Promise<void>;
  listRecordRefs(userId: string, recordId: string): Promise<MemoryRef[]>;
  search(input: {
    userId: string;
    sourceTypes: MemorySourceType[];
    embedding: number[];
    limit: number;
  }): Promise<MemoryIndexHit[]>;
  reset(): Promise<void>;
}
