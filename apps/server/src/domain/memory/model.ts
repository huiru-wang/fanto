export type MemorySourceType = "record";

export type MemoryRef = {
  userId: string;
  sourceType: MemorySourceType;
  sourceId: string;
};

export type MemoryDocument = MemoryRef & {
  content: string;
  contentHash: string;
};

export type MemoryIndexHit = MemoryRef & {
  content: string;
  distance: number;
};

export type MemorySearchResult = {
  sourceType: MemorySourceType;
  sourceId: string;
  snippet: string;
  distance: number;
};
