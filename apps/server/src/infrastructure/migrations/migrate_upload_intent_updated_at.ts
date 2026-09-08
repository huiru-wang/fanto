import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema.alterTable("upload_intents").addColumn("updated_at", "text", column => column.notNull().defaultTo("")).execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.alterTable("upload_intents").dropColumn("updated_at").execute();
}
