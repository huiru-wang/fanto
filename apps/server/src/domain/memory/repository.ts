import type { Memory, MemoryKind, MemorySearchResult } from "./model.js";

export interface MemoryRepository {
  countByUser(userId: string, kind?: MemoryKind): Promise<number>;
  create(input: Omit<Memory, "createdAt" | "updatedAt"> & { embedding: number[] }): Promise<Memory>;
  find(userId: string, memoryId: string): Promise<Memory | undefined>;
  list(userId: string, input: { kind?: MemoryKind; limit: number }): Promise<Memory[]>;
  update(input: Pick<Memory, "userId" | "memoryId" | "kind" | "content"> & { embedding: number[] }): Promise<Memory | undefined>;
  remove(userId: string, memoryId: string): Promise<boolean>;
  search(input: { userId: string; embedding: number[]; limit: number }): Promise<MemorySearchResult[]>;
}
