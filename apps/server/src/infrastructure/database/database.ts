/**
 * PostgreSQL 数据库初始化 — pg Pool + Kysely。
 */

import { Kysely, PostgresDialect, Migrator, sql, type MigrationProvider, type Migration } from "kysely";
import { Pool } from "pg";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DB } from "./schema.js";
import { logError, logInfo } from "../logging/logger.js";

export function createDatabase(databaseUrl: string): Kysely<DB> {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 10,
    min: 0,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 60_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 30_000,
    allowExitOnIdle: false,
  });

  // pg-pool emits errors from idle clients when a long-lived connection is
  // interrupted by the network or the remote pooler. Without a listener this
  // is an uncaught EventEmitter error and Node terminates the whole process.
  // pg-pool already removes the broken client, so logging is sufficient and a
  // later query can establish a fresh connection.
  pool.on("error", error => {
    logError("database", "Unexpected PostgreSQL idle client error", {
      code: (error as NodeJS.ErrnoException).code,
      message: error.message,
    });
  });

  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });
}

export async function warmDatabase(db: Kysely<DB>): Promise<void> {
  await sql`SELECT 1`.execute(db);
}

export async function checkDatabaseHealth(db: Kysely<DB>, timeoutMs = 5_000): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      warmDatabase(db),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Database health check timed out after ${timeoutMs}ms`)), timeoutMs);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
