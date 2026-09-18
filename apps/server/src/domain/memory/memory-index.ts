import type { MemoryDocument, MemoryIndexHit, MemoryRef, MemorySourceType } from "./model.js";

export interface MemoryIndex {
  isCurrent(ref: MemoryRef, contentHash: string): Promise<boolean>;
  replace(document: MemoryDocument, embedding: number[]): Promise<void>;
  remove(ref: MemoryRef): Promise<void>;
  search(input: {
    userId: string;
    sourceType: MemorySourceType;
    embedding: number[];
    limit: number;
  }): Promise<MemoryIndexHit[]>;
  reset(): Promise<void>;
}
