/** Explicit test-only seed. Never called by service startup or database migrations. */
import { loadEnv } from "./config.js";
import { createDatabase } from "../infrastructure/database/database.js";

loadEnv();
const url = process.env.DATABASE_URL?.trim();
if (!url) throw new Error("DATABASE_URL is required");
const db = createDatabase(url);
try {
  const now = new Date();
  await db.insertInto("users").values({ user_id: "user001", status: "active", created_at: now, updated_at: now, disabled_at: null })
    .onConflict(conflict => conflict.column("user_id").doNothing()).execute();
  const user = await db.selectFrom("users").select(["user_id", "status"]).where("user_id", "=", "user001").executeTakeFirstOrThrow();
  console.log(JSON.stringify(user));
} finally { await db.destroy(); }
