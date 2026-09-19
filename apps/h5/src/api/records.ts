import { requestJson } from "./http";

export type RecordStatus = "pending" | "updated" | "processing" | "processed";

export type RecordItem = {
  id: string;
  source: string;
  eventAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  status: RecordStatus;
  content: {
    text: string;
    blocks: Array<
      | { type: "image"; mediaId: string; description?: string }
      | { type: "audio"; mediaId: string; transcription?: string }
    >;
  };
};

type RecordPage = {
  data: RecordItem[];
  hasMore: boolean;
  nextCursor: string | null;
  pageSize: number;
};

export async function listRecords(cursor?: string | null): Promise<RecordPage> {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  return requestJson<RecordPage>(`/api/records?${query}`);
}

export type RecordSearchHit = {
  recordId: string;
  sourceType: "record_text" | "image" | "audio";
  mediaId?: string | null;
  snippet: string;
  distance: number;
};

export async function getRecord(id: string): Promise<RecordItem> {
  return requestJson<RecordItem>(`/api/records/${encodeURIComponent(id)}`);
}

export async function searchRecords(query: string): Promise<RecordSearchHit[]> {
  const result = await requestJson<{ data: RecordSearchHit[] }>("/api/records/search", {
    method: "POST",
    body: JSON.stringify({ query, limit: 10 }),
  });
  return result.data;
}

export async function createRecord(text: string): Promise<RecordItem> {
  return requestJson<RecordItem>("/api/records", {
    method: "POST",
    body: JSON.stringify({
      text,
      media: [],
      source: "h5",
      eventAt: new Date().toISOString(),
    }),
  });
}
