import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("records")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("content", "text", (c) => c.notNull())
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("status", "text", (c) => c.notNull().defaultTo("active"))
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema.createIndex("idx_records_user_id").on("records").columns(["user_id", "created_at"]).execute();

  await db.schema.createTable("upload_intents")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("object_key", "text", (c) => c.notNull().unique())
    .addColumn("media_type", "text", (c) => c.notNull())
    .addColumn("mime_type", "text", (c) => c.notNull())
    .addColumn("bytes", "integer", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("media_id", "text")
    .addColumn("ext_data", "text")
    .addColumn("expires_at", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("idx_upload_intents_user_status").on("upload_intents").columns(["user_id", "status"]).execute();

  await db.schema.createTable("media_assets")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("object_key", "text", (c) => c.notNull().unique())
    .addColumn("media_type", "text", (c) => c.notNull())
    .addColumn("mime_type", "text", (c) => c.notNull())
    .addColumn("bytes", "integer", (c) => c.notNull())
    .addColumn("ext_data", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("idx_media_assets_user_id").on("media_assets").columns(["user_id", "created_at"]).execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("media_assets").execute();
  await db.schema.dropTable("upload_intents").execute();
  await db.schema.dropTable("records").execute();
}
