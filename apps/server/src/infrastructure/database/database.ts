/**
 * PostgreSQL 数据库初始化 — pg Pool + Kysely。
 */

import { Kysely, PostgresDialect, Migrator, sql, type MigrationProvider, type Migration } from "kysely";
import { Pool } from "pg";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DB } from "./schema.js";
import { logError, logInfo, logSql } from "../logging/logger.js";

export function createDatabase(databaseUrl: string): Kysely<DB> {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: new URL(databaseUrl).searchParams.get("sslmode") === "disable" ? false : { rejectUnauthorized: false },
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
    log: logSql,
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
    if (!/^\d{3}_[a-z0-9_]+$/.test(key)) throw new Error(`Invalid migration filename: ${file}; expected NNN_description.ts`);
    const mod = await import(pathToFileURL(resolve(dir, file)).href);
    migrations[key] = mod;
  }

  return { getMigrations: async () => migrations };
}

const OLD_BASELINE = "create_current_schema_20261019";
const NUMBERED_BASELINE = "001_create_current_schema";

/**
 * Kysely sorts migrations by filename. The old unnumbered baseline sorts after
 * all numbered files and would make a legitimate upgrade appear corrupt.
 * Rename ONLY its Kysely bookkeeping record, never historical user data.
 */
async function normalizeLegacyMigrationRecord(db: Kysely<DB>) {
  await db.transaction().execute(async trx => {
    const exists = await sql<{present:boolean}>`
      SELECT to_regclass('public.kysely_migration') IS NOT NULL AS present
    `.execute(trx);
    if (!exists.rows[0]?.present) return;
    const recorded = await sql<{name:string}>`
      SELECT name FROM kysely_migration
      WHERE name IN (${OLD_BASELINE}, ${NUMBERED_BASELINE})
      FOR UPDATE
    `.execute(trx);
    const names = recorded.rows.map(row => row.name);
    if (!names.includes(OLD_BASELINE)) return;
    if (names.includes(NUMBERED_BASELINE)) {
      throw new Error("Conflicting legacy and numbered migration records; manual inspection required");
    }
    await sql`UPDATE kysely_migration SET name=${NUMBERED_BASELINE} WHERE name=${OLD_BASELINE}`.execute(trx);
    logInfo("database", "Legacy migration name normalized", { from: OLD_BASELINE, to: NUMBERED_BASELINE });
  });
}

export async function runMigrations(kyselyDb: Kysely<DB>) {
  await normalizeLegacyMigrationRecord(kyselyDb);
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
