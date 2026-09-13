import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema.alterTable("records").addColumn("task_id", "text").execute();
  await db.updateTable("records").set({ status: "pending" }).where("status", "=", "active").execute();
  await db.schema.createIndex("idx_records_workflow").on("records").columns(["user_id", "status", "created_at", "record_id"]).execute();

  await db.schema.createTable("creations")
    .addColumn("id", "integer", c => c.primaryKey().autoIncrement())
    .addColumn("creation_id", "text", c => c.notNull().unique())
    .addColumn("user_id", "text", c => c.notNull())
    .addColumn("title", "text", c => c.notNull())
    .addColumn("type", "text", c => c.notNull())
    .addColumn("session_id", "text", c => c.notNull())
    .addColumn("summary", "text", c => c.notNull())
    .addColumn("content", "text", c => c.notNull())
    .addColumn("source", "text", c => c.notNull())
    .addColumn("status", "text", c => c.notNull())
    .addColumn("version", "integer", c => c.notNull())
    .addColumn("created_at", "text", c => c.notNull())
    .addColumn("updated_at", "text", c => c.notNull())
    .execute();
  await db.schema.createIndex("idx_creations_user_updated").on("creations").columns(["user_id", "updated_at", "creation_id"]).execute();

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
    .addColumn("created_at", "text", c => c.notNull())
    .addColumn("updated_at", "text", c => c.notNull())
    .execute();
  await db.schema.createIndex("idx_proposals_user_status").on("creation_proposals").columns(["user_id", "status", "created_at", "proposal_id"]).execute();
  await sql`CREATE UNIQUE INDEX idx_active_update_proposal ON creation_proposals(creation_id) WHERE operation = 'update' AND status IN ('generating', 'pending_confirmation')`.execute(db);
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("creation_proposals").execute();
  await db.schema.dropTable("creations").execute();
  await db.schema.dropIndex("idx_records_workflow").execute();
  await db.schema.alterTable("records").dropColumn("task_id").execute();
}
