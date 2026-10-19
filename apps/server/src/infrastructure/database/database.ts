/**
 * PostgreSQL 数据库初始化 — pg Pool + Kysely。
 */

import { Kysely, PostgresDialect, Migrator, sql, type MigrationProvider, type Migration } from "kysely";
import { Pool } from "pg";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DB } from "./schema.js";
import { createAgentCheckpointSchema, finishLegacyAgentUpgrade } from "./agent-schema.js";
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

// Published migrations are now represented by a single 2026-10-19 baseline.
// Only fully upgraded business schemas (through the Agent checkpoint migration)
// may be consolidated. The final Agent cleanup is optional because manually
// dropped Agent tables prevent it from executing; missing business migrations
// must never be silently marked as applied.
const BASELINE_MIGRATION = "create_current_schema_20261019";
const PREVIOUS_MIGRATIONS = [
  "create_current_schema",
  "zzzzzz_async_v3",
  "zzzzzzzzzzzz_agent_sessions_pg",
  "zzzzzzzzzzzzz_drop_users_wx_openid",
] as const;
const SQUASHED_MIGRATIONS = [
  "extend_auth_schema", "update_auth_challenge_purpose", "z_task_system_schema",
  "zz_project_domain_refactor", "zzz_record_location", "zzzz_drop_user_preferences",
  "zzzzz_memory_schema", "zzzzzz_creative_runtime", "zzzzzzz_project_domain_upgrade",
  "zzzzzzzz_project_summary_embedding", "zzzzzzzzz_proposal_creation_goal",
  "zzzzzzzzzz_media_object_deletions", "zzzzzzzzzzz_project_session_goal",
] as const;
const LAST_BASELINE_MIGRATIONS = [
  "create_current_schema_20261011", "drop_tasks_20261011", "user_character_20261017",
  "z_agent_session_snapshots_20261017", "zz_memory_kinds_20261017",
  "zzz_user_fanto_settings_20261018", "zzzz_user_profiles_20261018",
  "zzzzz_user_profile_cover_20261018", "zzzzzz_agent_checkpoint_20261019",
] as const;
const LAST_AGENT_CLEANUP = "zzzzzzz_agent_storage_cleanup_20261019";
const AGENT_TABLES = ["entries", "sessions", "usage_ledger"] as const;
const AGENT_COLUMNS: Record<string, string[]> = {
  sessions: ["id", "created_at", "next_seq", "user_id", "agent_id", "title", "tip_entry_id", "updated_at"],
  entries: ["session_id", "id", "parent_id", "seq", "type", "custom_type", "timestamp", "payload", "run_id"],
  usage_ledger: ["session_id", "id", "seq", "entry_id", "adjustment", "usage", "details", "run_id", "created_at", "provider", "model"],
};

/** Must run under the same advisory lock as Kysely's Migrator. */
async function ensureAgentTables(trx: Kysely<DB>, legacyCleanupPending: boolean): Promise<boolean> {
  const tableRows = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'agent_session' AND table_type = 'BASE TABLE'
  `.execute(trx);
  const tables = tableRows.rows.map(row => row.table_name);
  const active = AGENT_TABLES.filter(name => tables.includes(name));
  if (active.length === 0 && tables.length === 0) {
    // All Agent storage has been manually deleted. Recreate only current tables.
    await createAgentCheckpointSchema(trx);
    // A former main-session pointer cannot resolve after those rows were lost.
    await sql`UPDATE user_fanto_settings SET main_session_id = NULL
      WHERE main_session_id IS NOT NULL`.execute(trx);
    await sql`DROP INDEX IF EXISTS idx_proposals_accepted_creation`.execute(trx);
    logInfo("database", "Recreated missing Agent checkpoint tables (old session data is not recoverable)");
    return true;
  }
  if (active.length !== AGENT_TABLES.length) {
    throw new Error(`Partially missing Agent checkpoint tables: ${AGENT_TABLES.filter(name => !tables.includes(name)).join(", ")}; manual review required`);
  }
  if (legacyCleanupPending) await finishLegacyAgentUpgrade(trx);
  else if (tables.some(name => !AGENT_TABLES.includes(name as typeof AGENT_TABLES[number]))) {
    throw new Error("Obsolete Agent Session tables exist despite completed cleanup; manual review required");
  }

  const cols = await sql<{ table_name: string; column_name: string }>`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'agent_session'
  `.execute(trx);
  for (const table of AGENT_TABLES) {
    const actual = cols.rows.filter(row => row.table_name === table).map(row => row.column_name);
    const missing = AGENT_COLUMNS[table]!.filter(column => !actual.includes(column));
    if (missing.length) throw new Error(`Agent checkpoint table ${table} is missing columns: ${missing.join(", ")}`);
  }
  return false;
}

async function consolidateMigrationHistory(db: Kysely<DB>): Promise<void> {
  const result = await db.transaction().execute(async trx => {
    await sql`SELECT pg_advisory_xact_lock(3853314791062309107)`.execute(trx);
    const metadata = await sql<{ name: string | null }>`SELECT to_regclass('kysely_migration')::text AS name`.execute(trx);
    if (!metadata.rows[0]?.name) return { removed: 0, restored: false }; // Fresh DB.

    const history = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(trx);
    const names = new Set(history.rows.map(row => row.name));
    if (names.size === 0) {
      const existing = await sql<{name: string | null}>`SELECT to_regclass('users')::text AS name`.execute(trx);
      if (!existing.rows[0]?.name) return { removed: 0, restored: false }; // Interrupted fresh installation.
      throw new Error("Empty migration history in an existing database; manual review required");
    }
    if (names.has(BASELINE_MIGRATION)) {
      if (names.size !== 1) throw new Error("Unknown migrations alongside the current baseline");
      const restored = await ensureAgentTables(trx, false);
      return { removed: 0, restored };
    }

    const hasPrevious = PREVIOUS_MIGRATIONS.some(name => names.has(name));
    const hasSquashed = SQUASHED_MIGRATIONS.some(name => names.has(name));
    const required = [
      ...LAST_BASELINE_MIGRATIONS,
      ...(hasPrevious || hasSquashed ? PREVIOUS_MIGRATIONS : []),
      ...(hasSquashed ? SQUASHED_MIGRATIONS : []),
    ];
    const allowed = new Set<string>([...required, LAST_AGENT_CLEANUP]);
    const missing = required.filter(name => !names.has(name));
    const unknown = [...names].filter(name => !allowed.has(name));
    if (missing.length || unknown.length) {
      throw new Error(
        `Cannot consolidate incomplete/unknown migration history (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}). ` +
        "Complete the old migration chain before installing the new baseline.",
      );
    }

    const restored = await ensureAgentTables(trx, !names.has(LAST_AGENT_CLEANUP));
    await sql`INSERT INTO kysely_migration (name, timestamp)
      SELECT ${BASELINE_MIGRATION}, MAX(timestamp) FROM kysely_migration`.execute(trx);
    await sql`DELETE FROM kysely_migration WHERE name <> ${BASELINE_MIGRATION}`.execute(trx);
    return { removed: names.size, restored };
  });
  if (result.removed) logInfo("database", "Consolidated migration history", { removed: result.removed });
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
