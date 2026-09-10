import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("vector_items")
    .addColumn("id", "integer", c => c.primaryKey().autoIncrement())
    .addColumn("user_id", "text", c => c.notNull())
    .addColumn("type", "text", c => c.notNull())
    .addColumn("outer_id", "text", c => c.notNull())
    .addColumn("content", "text", c => c.notNull())
    .addColumn("content_hash", "text", c => c.notNull())
    .addColumn("status", "text", c => c.notNull())
    .addColumn("error_code", "text")
    .addColumn("indexed_at", "text")
    .addColumn("created_at", "text", c => c.notNull())
    .execute();
  await db.schema.createIndex("idx_vector_items_lookup").on("vector_items").columns(["user_id", "type", "outer_id", "status"]).execute();
  await sql`CREATE VIRTUAL TABLE record_vectors USING vec0(embedding float[1536])`.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`DROP TABLE record_vectors`.execute(db);
  await db.schema.dropTable("vector_items").execute();
}
