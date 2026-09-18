import type { RecordContent } from "@fanto/shared";
import type { Kysely } from "kysely";
import type { MemoryIndex } from "../../domain/memory/memory-index.js";
import type { MemoryService } from "../../domain/memory/memory-service.js";
import type { Record } from "../../domain/records/record.js";
import type { DB } from "../database/schema.js";

const toRecord = (row: any): Record => ({
  extData: row.ext_data ? JSON.parse(row.ext_data) : null,
  id: row.record_id,
  userId: row.user_id,
  source: row.source,
  content: JSON.parse(row.content) as RecordContent,
  version: row.version,
  status: row.status,
  taskId: row.task_id,
  eventAt: row.event_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function rebuildMemoryIndex(
  db: Kysely<DB>,
  index: Pick<MemoryIndex, "reset">,
  memory: Pick<MemoryService, "replaceRecord">,
  options: { batchSize?: number; onBatch?: (stats: { records: number; users: number }) => void } = {},
): Promise<{ records: number; users: number }> {
  const batchSize = options.batchSize ?? 500;
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error("batchSize must be a positive integer");

  await index.reset();

  let lastId = 0;
  let records = 0;
  const users = new Set<string>();

  for (;;) {
    const rows = await db
      .selectFrom("records")
      .selectAll()
      .where("id", ">", lastId)
      .where("status", "=", "processed")
      .orderBy("id", "asc")
      .limit(batchSize)
      .execute();

    if (!rows.length) break;

    for (const row of rows) {
      const record = toRecord(row);
      await memory.replaceRecord(record);
      users.add(record.userId);
      records += 1;
      lastId = Number(row.id);
    }

    options.onBatch?.({ records, users: users.size });
  }

  return { records, users: users.size };
}
