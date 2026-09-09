import type { Kysely } from "kysely";
import type { DB } from "../infrastructure/schema.js";

export const COMPACTION_THRESHOLD = 50;

export async function getMessageCount(db: Kysely<DB>, sessionId: string, userId: string): Promise<number> {
  const result = await db
    .selectFrom("messages")
    .select(db.fn.countAll<number>().as("count"))
    .where("session_id", "=", sessionId)
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();
  return result.count;
}
