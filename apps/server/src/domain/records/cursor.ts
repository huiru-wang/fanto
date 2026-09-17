export interface RecordCursor {
  eventAt: string;
  id?: string;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

export function encodeRecordCursor(record: { eventAt: string; id: string }): string {
  return Buffer.from(JSON.stringify({ eventAt: record.eventAt, id: record.id })).toString("base64url");
}

export function decodeRecordCursor(cursor: string): RecordCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (isTimestamp(value?.eventAt) && typeof value.id === "string" && value.id.trim()) {
      return { eventAt: value.eventAt, id: value.id };
    }
  } catch { /* Invalid cursors are rejected by the HTTP route. */ }
  throw new Error("Invalid record cursor");
}
