/**
 * PostgreSQL 数据库初始化 — pg Pool + Kysely。
 */

import { Kysely, PostgresDialect, Migrator, type MigrationProvider, type Migration } from "kysely";
import { Pool } from "pg";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DB } from "./schema.js";
import { logError, logInfo } from "../logging/logger.js";

export function createDatabase(databaseUrl: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } }),
    }),
  });
}

/** 动态加载 migrations 目录下的 .ts/.js 文件 */
async function createMigrationProvider(): Promise<MigrationProvider> {
  const dir = resolve("src/migrations");
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
