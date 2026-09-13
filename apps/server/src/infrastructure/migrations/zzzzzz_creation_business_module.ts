import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema.dropTable("creation_proposals").ifExists().execute();
  await db.schema.dropTable("creations").ifExists().execute();
  await db.schema.dropTable("creation_kinds").ifExists().execute();
  await db.schema.dropTable("entity_relations").ifExists().execute();
  await db.schema.createTable("creation_kinds").addColumn("kind_id", "text", c => c.primaryKey()).addColumn("owner_user_id", "text").addColumn("name", "text", c => c.notNull()).addColumn("title", "text", c => c.notNull()).addColumn("created_at", "text", c => c.notNull()).addColumn("updated_at", "text", c => c.notNull()).execute();
  await db.schema.createTable("creations").addColumn("id", "integer", c => c.primaryKey().autoIncrement()).addColumn("creation_id", "text", c => c.notNull().unique()).addColumn("user_id", "text", c => c.notNull()).addColumn("title", "text", c => c.notNull()).addColumn("kind_id", "text", c => c.notNull()).addColumn("session_id", "text", c => c.notNull()).addColumn("summary", "text", c => c.notNull()).addColumn("content", "text", c => c.notNull()).addColumn("status", "text", c => c.notNull()).addColumn("version", "integer", c => c.notNull()).addColumn("created_at", "text", c => c.notNull()).addColumn("updated_at", "text", c => c.notNull()).execute();
  await db.schema.createTable("creation_proposals").addColumn("id", "integer", c => c.primaryKey().autoIncrement()).addColumn("proposal_id", "text", c => c.notNull().unique()).addColumn("user_id", "text", c => c.notNull()).addColumn("creation_id", "text").addColumn("base_creation_version", "integer").addColumn("operation", "text", c => c.notNull()).addColumn("session_id", "text", c => c.notNull()).addColumn("title", "text").addColumn("kind_id", "text").addColumn("summary", "text").addColumn("content", "text").addColumn("ext_data", "text").addColumn("status", "text", c => c.notNull()).addColumn("error", "text").addColumn("created_at", "text", c => c.notNull()).addColumn("updated_at", "text", c => c.notNull()).execute();
  await db.schema.createTable("entity_relations").addColumn("relation_id", "text", c => c.primaryKey()).addColumn("user_id", "text", c => c.notNull()).addColumn("source_entity_id", "text", c => c.notNull()).addColumn("source_entity_type", "text", c => c.notNull()).addColumn("target_entity_id", "text", c => c.notNull()).addColumn("target_entity_type", "text", c => c.notNull()).addColumn("relation_type", "text", c => c.notNull()).addColumn("source_created_at", "text", c => c.notNull()).addColumn("created_at", "text", c => c.notNull()).addUniqueConstraint("entity_relations_unique", ["user_id", "source_entity_id", "target_entity_id", "relation_type"]).execute();
  await sql`CREATE INDEX idx_entity_relations_target_records ON entity_relations(user_id,target_entity_type,target_entity_id,relation_type,source_created_at DESC,source_entity_id DESC)`.execute(db);
  await sql`CREATE INDEX idx_entity_relations_source ON entity_relations(user_id,source_entity_type,source_entity_id,relation_type,target_entity_type,target_entity_id)`.execute(db);
  await sql`CREATE INDEX idx_creations_user_status_updated ON creations(user_id,status,updated_at DESC,creation_id DESC)`.execute(db);
  await sql`CREATE INDEX idx_creations_user_kind_status_updated ON creations(user_id,kind_id,status,updated_at DESC,creation_id DESC)`.execute(db);
  await sql`CREATE INDEX idx_creation_proposals_user_status_updated ON creation_proposals(user_id,status,updated_at DESC,proposal_id DESC)`.execute(db);
  await sql`CREATE UNIQUE INDEX idx_creation_kinds_system_name ON creation_kinds(name) WHERE owner_user_id IS NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX idx_creation_kinds_user_name ON creation_kinds(owner_user_id,name) WHERE owner_user_id IS NOT NULL`.execute(db);
}
export async function down() {}
