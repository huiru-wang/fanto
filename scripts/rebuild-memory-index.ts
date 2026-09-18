import { loadConfig, loadEnv } from "../apps/server/src/bootstrap/config.js";
import { MemoryService } from "../apps/server/src/domain/memory/memory-service.js";
import { EmbeddingsClient } from "../apps/server/src/infrastructure/clients/embeddings-client.js";
import { createDatabase, runMigrations } from "../apps/server/src/infrastructure/database/database.js";
import { rebuildMemoryIndex } from "../apps/server/src/infrastructure/memory/rebuild-memory-index.js";
import { SqliteVecMemoryIndex } from "../apps/server/src/infrastructure/memory/sqlite-vec-memory-index.js";

async function main() {
  loadEnv();
  const config = loadConfig();
  const db = createDatabase(config.sqlitePath);

  try {
    await runMigrations(db);

    const index = new SqliteVecMemoryIndex(db);
    const memory = new MemoryService(
      index,
      new EmbeddingsClient(
        config.embeddingApiKey ?? "",
        config.embeddingApiBase,
        config.embeddingModel,
        config.embeddingDimension,
      ),
    );

    const stats = await rebuildMemoryIndex(db, index, memory, {
      batchSize: 500,
      onBatch: batch => console.log(`[memory] rebuilt batch: records=${batch.records} users=${batch.users}`),
    });
    console.log(`[memory] rebuild complete: records=${stats.records} users=${stats.users}`);
  } finally {
    await db.destroy();
  }

}

main().catch(error => {
  console.error("[memory] rebuild failed", error);
  process.exitCode = 1;
});
