import { sql, type Kysely } from "kysely";

/** Removes the retired Preference domain and all persisted preference data. */
export async function up(db: Kysely<any>) {
  await sql`DROP TABLE IF EXISTS user_preferences;`.execute(db);
}

export async function down(_db: Kysely<any>) {
  throw new Error("The retired user_preferences table cannot be restored without its deleted data");
}
