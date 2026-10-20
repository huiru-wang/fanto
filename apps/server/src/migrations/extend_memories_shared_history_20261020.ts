import { sql, type Kysely } from "kysely";

/** Forward-only: the consolidated baseline may already have run on existing databases. */
export async function up(db: Kysely<any>) {
  await sql`ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_kind_check`.execute(db);
  await sql`ALTER TABLE memories ADD CONSTRAINT memories_kind_check
    CHECK (kind IN ('profile', 'goal', 'guidance', 'personal_background', 'important_relationships',
      'current_focus', 'interaction_preferences', 'shared_history'))`.execute(db);
}

export async function down(_db: Kysely<any>) { /* Forward only: retaining saved memories is intentional. */ }
