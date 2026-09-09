import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("users")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("user_id", "text", (c) => c.notNull().unique())
    .addColumn("wx_openid", "text", (c) => c.notNull().unique())
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("users").execute();
}
