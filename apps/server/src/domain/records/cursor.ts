export interface RecordCursor {
  createdAt: string;
  id?: string;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

export function encodeRecordCursor(record: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: record.createdAt, id: record.id })).toString("base64url");
}

export function decodeRecordCursor(cursor: string): RecordCursor {
  // Older clients supplied only the timestamp.
  if (isTimestamp(cursor)) return { createdAt: cursor };
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (isTimestamp(value?.createdAt) && typeof value.id === "string" && value.id.trim()) {
      return { createdAt: value.createdAt, id: value.id };
    }
  } catch { /* Invalid cursors are rejected by the HTTP route. */ }
  throw new Error("Invalid record cursor");
}
