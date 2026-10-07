import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<any>) {
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS embedding vector(768)`.execute(db);
}
export async function down(db: Kysely<any>) {
  await sql`ALTER TABLE projects DROP COLUMN IF EXISTS embedding`.execute(db);
}
