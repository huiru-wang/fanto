import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  const messages = (await db.introspection.getTables()).find((table) => table.name === "messages");
  if (messages) await db.schema.dropTable("messages").execute();
}
