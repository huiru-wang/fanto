/**
 * 独立迁移脚本：tsx src/infrastructure/migrate.ts
 */

import { loadEnv, loadConfig } from "../env.js";
import { createDatabase, runMigrations } from "./database.js";
import { logInfo } from "./logger.js";

loadEnv();
const config = loadConfig();
const db = createDatabase(config.sqlitePath);

logInfo("migrate", "Running migrations");
await runMigrations(db);
logInfo("migrate", "Migrations completed");

db.destroy();
