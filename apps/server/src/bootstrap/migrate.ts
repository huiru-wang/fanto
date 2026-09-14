/**
 * 独立迁移脚本：tsx src/bootstrap/migrate.ts
 */

import { loadEnv, loadConfig } from "./config.js";
import { createDatabase, runMigrations } from "../infrastructure/database/database.js";
import { logInfo } from "../infrastructure/logging/logger.js";

loadEnv();
const config = loadConfig();
const db = createDatabase(config.sqlitePath);

logInfo("migrate", "Running migrations");
await runMigrations(db);
logInfo("migrate", "Migrations completed");

db.destroy();
