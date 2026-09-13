import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`UPDATE creations SET summary = json_extract(summary, '$.overview') WHERE summary IS NOT NULL AND json_valid(summary) AND json_type(summary, '$.overview') = 'text'`.execute(db);
  await sql`UPDATE creation_proposals SET summary = json_extract(summary, '$.overview') WHERE summary IS NOT NULL AND json_valid(summary) AND json_type(summary, '$.overview') = 'text'`.execute(db);
}
export async function down() {}
