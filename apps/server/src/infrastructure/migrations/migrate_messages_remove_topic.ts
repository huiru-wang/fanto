import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  const messages = (await db.introspection.getTables()).find((table) => table.name === "messages");
  if (!messages?.columns.some((column) => column.name === "topic_id")) return;

  await db.schema
    .createTable("messages_replacement")
    .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
    .addColumn("user_id", "text", (column) => column.notNull())
    .addColumn("session_id", "text", (column) => column.notNull())
    .addColumn("role", "text", (column) => column.notNull())
    .addColumn("payload", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .execute();
  await sql`insert into messages_replacement (id, user_id, session_id, role, payload, created_at, updated_at)
    select id, user_id, session_id, role, payload,
      strftime('%Y-%m-%dT%H:%M:%fZ', timestamp / 1000.0, 'unixepoch'),
      strftime('%Y-%m-%dT%H:%M:%fZ', timestamp / 1000.0, 'unixepoch')
    from messages`.execute(db);
  await db.schema.dropTable("messages").execute();
  await db.schema.alterTable("messages_replacement").renameTo("messages").execute();
  await db.schema.createIndex("idx_messages_session_id").on("messages").columns(["user_id", "session_id", "created_at"]).execute();
}

export async function down() {}
