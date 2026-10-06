export type RecordIndexSourceType = "record_text" | "record_location" | "image" | "audio";

export type RecordIndexRef = {
  userId: string;
  sourceType: RecordIndexSourceType;
  sourceId: string;
};

export type RecordIndexDocument = RecordIndexRef & {
  recordId: string;
  mediaId: string | null;
  eventAt: string;
  content: string;
  contentHash: string;
};

export type RecordIndexHit = RecordIndexRef & {
  eventAt: string;
  content: string;
  distance: number;
};

export type RecordSearchResult = {
  sourceType: RecordIndexSourceType;
  sourceId: string;
  recordId: string;
  mediaId: string | null;
  snippet: string;
  distance: number;
  eventAt: string;
};
