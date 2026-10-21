import { sql, type Kysely } from "kysely";

/**
 * Retire the obsolete User/Fanto Memory store after migration 002.
 *
 * Existing data in memories_legacy_002 is intentionally discarded. Keeping
 * 002 immutable supports databases that already applied it; this migration
 * drops the archive in both old-schema upgrades and previously upgraded DBs.
 * No CASCADE: unexpected dependencies must abort rather than delete more data.
 */
export async function up(db: Kysely<any>) {
  await sql`DROP TABLE IF EXISTS public.memories_legacy_002`.execute(db);
}

export async function down(_db: Kysely<any>) { /* Forward-only: legacy data cannot be restored. */ }
