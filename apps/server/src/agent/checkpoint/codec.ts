import type { Entry, EntryStructure, UsageRow } from "@earendil-works/pi-agent-core";

export function safeNumber(value: number | string, field: string): number {
  const result = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid PostgreSQL BIGINT ${field}: ${String(value)}`);
  return result;
}

export function json(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Cannot persist undefined JSON value");
  return encoded;
}

export interface PgEntryRow {
  id: string; parent_id: string | null; seq: number | string;
  type: string; custom_type: string | null; timestamp: number | string; payload: unknown;
}

export function payloadForEntry(entry: Entry): unknown {
  switch (entry.type) {
    case "message": return { message: entry.message, ...(entry.terminate === undefined ? {} : { terminate: entry.terminate }) };
    case "compaction": return {
      summary: entry.summary, retainedTail: entry.retainedTail, tokensBefore: entry.tokensBefore,
      ...(entry.details === undefined ? {} : { details: entry.details }),
      ...(entry.usage === undefined ? {} : { usage: entry.usage }), fromHook: entry.fromHook,
    };
    case "branch_summary": return {
      fromId: entry.fromId, summary: entry.summary,
      ...(entry.details === undefined ? {} : { details: entry.details }),
      ...(entry.usage === undefined ? {} : { usage: entry.usage }), fromHook: entry.fromHook,
    };
    case "custom": return entry.data === undefined ? {} : { data: entry.data };
  }
}

export function decodeEntry(row: PgEntryRow): Entry {
  const base = {
    id: row.id, parentId: row.parent_id,
    seq: safeNumber(row.seq, "entries.seq"),
    timestamp: safeNumber(row.timestamp, "entries.timestamp"),
  };
  const data = row.payload as Record<string, unknown>;
  switch (row.type) {
    case "message": return { ...base, type: "message", ...data } as Entry;
    case "compaction": return { ...base, type: "compaction", ...data } as Entry;
    case "branch_summary": return { ...base, type: "branch_summary", ...data } as Entry;
    case "custom": {
      if (row.custom_type === null) throw new Error(`Custom entry ${row.id} is missing custom_type`);
      return { ...base, type: "custom", customType: row.custom_type, ...data } as Entry;
    }
    default: throw new Error(`Unknown Session entry type: ${row.type}`);
  }
}

export function entryStructure(row: PgEntryRow): EntryStructure {
  return {
    id: row.id, parentId: row.parent_id, seq: safeNumber(row.seq, "entry.seq"),
    timestamp: safeNumber(row.timestamp, "entry.timestamp"),
    type: row.type as EntryStructure["type"],
    ...(row.custom_type === null ? {} : { customType: row.custom_type }),
  };
}

export interface PgUsageRow {
  id: string; seq: number | string; entry_id: string | null;
  adjustment: boolean; usage: UsageRow["usage"]; details: unknown | null;
}

export function decodeUsage(row: PgUsageRow): UsageRow {
  return {
    id: row.id, seq: safeNumber(row.seq, "usage.seq"), usage: row.usage,
    ...(row.entry_id === null ? {} : { entryId: row.entry_id }),
    adjustment: row.adjustment,
    ...(row.details === null ? {} : { details: row.details }),
  } as UsageRow;
}
