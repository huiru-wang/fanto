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

// All migrations through 2026-10-08 are incorporated into create_current_schema.
// Keep these names only to safely consolidate Kysely metadata on databases
// that have already finished the old migration chain. Partial histories must
// first be brought up to date using the previous release.
const BASELINE_MIGRATION = "create_current_schema";
const SQUASHED_MIGRATIONS = [
  "extend_auth_schema",
  "update_auth_challenge_purpose",
  "z_task_system_schema",
  "zz_project_domain_refactor",
  "zzz_record_location",
  "zzzz_drop_user_preferences",
  "zzzzz_memory_schema",
  "zzzzzz_creative_runtime",
  "zzzzzzz_project_domain_upgrade",
  "zzzzzzzz_project_summary_embedding",
  "zzzzzzzzz_proposal_creation_goal",
  "zzzzzzzzzz_media_object_deletions",
  "zzzzzzzzzzz_project_session_goal",
] as const;

async function consolidateMigrationHistory(db: Kysely<DB>): Promise<void> {
  const removed = await db.transaction().execute(async trx => {
    // Same transaction advisory lock as Kysely 0.27's PostgresAdapter.
    await sql`SELECT pg_advisory_xact_lock(3853314791062309107)`.execute(trx);
    const table = await sql<{ name: string | null }>`SELECT to_regclass('kysely_migration')::text AS name`.execute(trx);
    if (!table.rows[0]?.name) return 0; // Fresh DB: Migrator creates its own metadata.

    const history = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(trx);
    const names = new Set(history.rows.map(row => row.name));
    // After the squash, future migrations may legitimately appear alongside the baseline.
    // Let Kysely validate those names instead of treating them as old history.
    if (!SQUASHED_MIGRATIONS.some(name => names.has(name))) return 0;

    const expected = [BASELINE_MIGRATION, ...SQUASHED_MIGRATIONS];
    const known = new Set<string>([...expected, "zzzzzz_async_v3"]);
    const missing = expected.filter(name => !names.has(name));
    const unknown = [...names].filter(name => !known.has(name));
    if (missing.length || unknown.length) {
      throw new Error(
        `Cannot consolidate incomplete/unknown migration history (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}). ` +
        "Run the old migration chain to completion before deploying the consolidated baseline.",
      );
    }

    await sql`DELETE FROM kysely_migration WHERE name <> ${BASELINE_MIGRATION} AND name <> 'zzzzzz_async_v3'`.execute(trx);
    return SQUASHED_MIGRATIONS.length;
  });
  if (removed) logInfo("database", "Consolidated migration history", { removed });
}

/** Repair a manually dropped projects table without resetting migration history. */
async function restoreMissingProjectsTable(db: Kysely<DB>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`SELECT pg_advisory_xact_lock(3853314791062309107)`.execute(trx);
    const state = await sql<{ migration_exists: boolean; projects_exists: boolean }>`
      SELECT to_regclass('kysely_migration') IS NOT NULL AS migration_exists,
             to_regclass('projects') IS NOT NULL AS projects_exists
    `.execute(trx);
    if (!state.rows[0]?.migration_exists || state.rows[0].projects_exists) return;
    const baseline = await sql<{ applied: boolean }>`
      SELECT EXISTS (SELECT 1 FROM kysely_migration WHERE name = ${BASELINE_MIGRATION}) AS applied
    `.execute(trx);
    if (!baseline.rows[0]?.applied) return;

    await sql`
      CREATE TABLE projects (
        project_id UUID PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        session_id TEXT UNIQUE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        embedding vector(768),
        cover_media_id TEXT,
        goal JSONB NOT NULL DEFAULT '{}'::jsonb,
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued',
        version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `.execute(trx);
    await sql`CREATE INDEX idx_projects_user_status_updated ON projects(user_id, status, updated_at DESC, project_id DESC)`.execute(trx);
    logInfo('database', 'Restored manually dropped projects table');
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
  await consolidateMigrationHistory(kyselyDb);
  await restoreMissingProjectsTable(kyselyDb);
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
