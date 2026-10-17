import { sql, type Kysely } from "kysely";

/** Expand the constraint only; leave existing memory kinds and content untouched. */
export async function up(db: Kysely<any>) {
  await sql`ALTER TABLE memories DROP CONSTRAINT memories_kind_check`.execute(db);
  await sql`ALTER TABLE memories ADD CONSTRAINT memories_kind_check CHECK (
    kind IN ('profile', 'goal', 'guidance', 'personal_background', 'important_relationships', 'current_focus', 'interaction_preferences')
  )`.execute(db);
}

export async function down(db: Kysely<any>) {
  // Refuse rollback with new data rather than deleting or reclassifying user memories.
  await sql`ALTER TABLE memories DROP CONSTRAINT memories_kind_check`.execute(db);
  await sql`ALTER TABLE memories ADD CONSTRAINT memories_kind_check CHECK (kind IN ('profile', 'goal', 'guidance'))`.execute(db);
}
