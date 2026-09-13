import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("messages")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("session_id", "text", (c) => c.notNull())
    .addColumn("role", "text", (c) => c.notNull())
    .addColumn("payload", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("idx_messages_session_id")
    .on("messages")
    .columns(["user_id", "session_id", "created_at"])
    .execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("messages").execute();
}
