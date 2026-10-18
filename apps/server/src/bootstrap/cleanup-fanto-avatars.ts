import { loadEnv, loadConfig } from "./config.js";
import { createDatabase } from "../infrastructure/database/database.js";
import { createObjectStorage } from "./create-object-storage.js";
import { MediaService } from "../domain/media/index.js";
loadEnv();
const config = loadConfig();
const db = createDatabase(config.databaseUrl);
try {
    console.log(await MediaService.create(db, createObjectStorage(config)).cleanupAvatars(db, process.argv.includes("--apply")));
}
finally {
    await db.destroy();
}
