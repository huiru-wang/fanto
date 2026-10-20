import type { Memory, MemoryKind, MemoryOwner, MemorySearchResult } from "./model.js";
export interface MemoryRepository {
  countByOwner(owner: MemoryOwner, kind?: MemoryKind): Promise<number>;
  create(input: Omit<Memory, "createdAt"|"updatedAt"> & {embedding:number[]}): Promise<Memory>;
  find(owner: MemoryOwner, memoryId: string): Promise<Memory | undefined>;
  list(owner: MemoryOwner, input: {kind?:MemoryKind;limit:number}): Promise<Memory[]>;
  update(input: Pick<Memory, "ownerType"|"ownerId"|"memoryId"|"kind"|"content"> & {embedding:number[]}): Promise<Memory|undefined>;
  remove(owner: MemoryOwner, memoryId: string): Promise<boolean>;
  search(input: MemoryOwner & {embedding:number[];limit:number;kinds?:readonly MemoryKind[]}): Promise<MemorySearchResult[]>;
}
