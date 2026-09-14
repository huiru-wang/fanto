import { loadConfig, loadEnv } from "../apps/server/src/bootstrap/config.js";
import { RecordMemoryService } from "../apps/server/src/domain/memory/record-index.js";
import { SqliteRecordRepository } from "../apps/server/src/domain/records/sqlite-repository.js";
import { createDatabase, runMigrations } from "../apps/server/src/infrastructure/database/database.js";

loadEnv();
const config = loadConfig();
const db = createDatabase(config.sqlitePath);

try {
  await runMigrations(db);

  const recordRepo = new SqliteRecordRepository(db);
  const memory = new RecordMemoryService(db, config);

  const records = await recordRepo.findByUserId("default-user", { limit: 10_000 });
  for (const record of records) {
    await memory.index({ userId: record.userId, recordId: record.id, operation: "replace" });
  }

  console.log(`[vector] rebuilt record index: records=${records.length}`);
} finally {
  await db.destroy();
}
