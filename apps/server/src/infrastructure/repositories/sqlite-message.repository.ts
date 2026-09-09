import type { Kysely } from "kysely";
import type { DB } from "../schema.js";
import type { MessageRepository } from "../../modules/message/message.repository.js";
import type { Message } from "../../modules/message/message.js";

export class SqliteMessageRepository implements MessageRepository {
  constructor(private db: Kysely<DB>) {}

  async save(input: Omit<Message, "id">): Promise<number> {
    const result = await this.db.insertInto("messages").values({
      user_id: input.userId,
      session_id: input.sessionId,
      role: input.role,
      payload: input.payload,
      created_at: input.createdAt,
      updated_at: input.updatedAt,
    }).returning("id").executeTakeFirstOrThrow();
    return result.id;
  }

  async findBySessionId(sessionId: string, userId: string): Promise<Message[]> {
    const rows = await this.db
      .selectFrom("messages")
      .selectAll()
      .where("user_id", "=", userId)
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      role: row.role,
      payload: row.payload,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
