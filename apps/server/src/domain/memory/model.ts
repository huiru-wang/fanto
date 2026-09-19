export type MemorySourceType = "record_text" | "image" | "audio";

export type MemoryRef = {
  userId: string;
  sourceType: MemorySourceType;
  sourceId: string;
};

export type MemoryDocument = MemoryRef & {
  recordId: string;
  mediaId: string | null;
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
  recordId: string;
  mediaId: string | null;
  snippet: string;
  distance: number;
};
