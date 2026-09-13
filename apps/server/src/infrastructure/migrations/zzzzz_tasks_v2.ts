import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema.dropTable("tasks").execute();
  await db.schema.createTable("tasks")
    .addColumn("id", "integer", c => c.primaryKey().autoIncrement())
    .addColumn("task_id", "text", c => c.notNull().unique())
    .addColumn("user_id", "text", c => c.notNull())
    .addColumn("type", "text", c => c.notNull())
    .addColumn("status", "text", c => c.notNull())
    .addColumn("payload", "text", c => c.notNull())
    .addColumn("execution_metadata", "text", c => c.notNull())
    .addColumn("error_code", "text")
    .addColumn("error_message", "text")
    .addColumn("created_at", "text", c => c.notNull())
    .addColumn("updated_at", "text", c => c.notNull())
    .execute();
  await db.schema.createIndex("idx_tasks_user_created").on("tasks").columns(["user_id", "created_at", "task_id"]).execute();
  await db.schema.createIndex("idx_tasks_queue").on("tasks").columns(["type", "status", "created_at", "task_id"]).execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("tasks").execute();
}
