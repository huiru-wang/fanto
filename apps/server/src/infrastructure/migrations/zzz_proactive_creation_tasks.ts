import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema.dropTable("creation_proposals").execute();
  await db.schema.createTable("creation_proposals")
    .addColumn("id", "integer", c => c.primaryKey().autoIncrement())
    .addColumn("proposal_id", "text", c => c.notNull().unique())
    .addColumn("user_id", "text", c => c.notNull())
    .addColumn("creation_id", "text")
    .addColumn("base_creation_version", "integer")
    .addColumn("operation", "text", c => c.notNull())
    .addColumn("session_id", "text", c => c.notNull())
    .addColumn("title", "text")
    .addColumn("type", "text")
    .addColumn("summary", "text")
    .addColumn("content", "text")
    .addColumn("source", "text")
    .addColumn("status", "text", c => c.notNull())
    .addColumn("failure_code", "text")
    .addColumn("failure_message", "text")
    .addColumn("created_at", "text", c => c.notNull())
    .addColumn("updated_at", "text", c => c.notNull())
    .execute();
  await db.schema.createIndex("idx_proposals_user_status").on("creation_proposals").columns(["user_id", "status", "created_at", "proposal_id"]).execute();
  await sql`CREATE UNIQUE INDEX idx_active_update_proposal ON creation_proposals(creation_id) WHERE operation = 'update' AND status IN ('generating', 'pending_confirmation')`.execute(db);
  await db.schema.createTable("proactive_tasks")
    .addColumn("id", "integer", c => c.primaryKey().autoIncrement())
    .addColumn("task_id", "text", c => c.notNull().unique())
    .addColumn("user_id", "text", c => c.notNull())
    .addColumn("status", "text", c => c.notNull())
    .addColumn("session_metadata", "text", c => c.notNull())
    .addColumn("error_code", "text")
    .addColumn("error_message", "text")
    .addColumn("created_at", "text", c => c.notNull())
    .addColumn("updated_at", "text", c => c.notNull())
    .addColumn("finished_at", "text")
    .execute();
  await db.schema.createIndex("idx_proactive_tasks_user_created").on("proactive_tasks").columns(["user_id", "created_at", "task_id"]).execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("proactive_tasks").execute();
}
