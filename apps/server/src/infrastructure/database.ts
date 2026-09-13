/**
 * SQLite 数据库初始化 — better-sqlite3 + WAL + Kysely。
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { Kysely, SqliteDialect, Migrator, type MigrationProvider, type Migration } from "kysely";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DB } from "./schema.js";
import { logError, logInfo, logWarn } from "./logger.js";

export function createDatabase(sqlitePath: string): Kysely<DB> {
  const db = new Database(sqlitePath);

  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  try {
    sqliteVec.load(db);
    const version = db.prepare("select vec_version() as version").get() as { version: string };
    logInfo("database", "sqlite-vec loaded", { version: version.version });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    logWarn("database", "sqlite-vec unavailable", { message });
  }

  return new Kysely<DB>({
    dialect: new SqliteDialect({ database: db }),
  });
}

/** 动态加载 migrations 目录下的 .ts/.js 文件 */
async function createMigrationProvider(): Promise<MigrationProvider> {
  const dir = resolve("src/infrastructure/migrations");
  const files = await readdir(dir);
  const migrations: Record<string, Migration> = {};

  for (const file of files.sort()) {
    if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
    const key = file.replace(/\.(ts|js)$/, "");
    const mod = await import(pathToFileURL(resolve(dir, file)).href);
    migrations[key] = mod;
  }

  return { getMigrations: async () => migrations };
}

export async function runMigrations(kyselyDb: Kysely<DB>) {
  const provider = await createMigrationProvider();

  const migrator = new Migrator({ db: kyselyDb, provider });
  const { error, results } = await migrator.migrateToLatest();

  if (results) {
    for (const r of results) {
      if (r.status === "Success") {
        logInfo("database", "Migration completed", { migration: r.migrationName });
      } else if (r.status === "Error") {
        logError("database", "Migration failed", { migration: r.migrationName });
      }
    }
  }

  if (error) throw error;
}
