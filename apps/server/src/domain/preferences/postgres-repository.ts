import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import { nowIso } from "../../infrastructure/time.js";
import type { PreferenceCategory, UserPreference } from "./model.js";
import type { PreferenceMutationResult, PreferenceRepository } from "./repository.js";

const toPreference = (row: {
  preference_id: string;
  user_id: string;
  category: string;
  content: string;
  source_session_id: string;
  source_message_id: string;
  source_quote: string;
  version: number;
  created_at: string;
  updated_at: string;
}): UserPreference => ({
  preferenceId: row.preference_id,
  userId: row.user_id,
  category: row.category as PreferenceCategory,
  content: row.content,
  sourceSessionId: row.source_session_id,
  sourceMessageId: row.source_message_id,
  sourceQuote: row.source_quote,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class PostgresPreferenceRepository implements PreferenceRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async listByUser(userId: string, limit: number): Promise<UserPreference[]> {
    const rows = await this.db.selectFrom("user_preferences")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(limit)
      .execute();
    return rows.map(toPreference);
  }

  async findById(userId: string, preferenceId: string): Promise<UserPreference | undefined> {
    const row = await this.db.selectFrom("user_preferences")
      .selectAll()
      .where("user_id", "=", userId)
      .where("preference_id", "=", preferenceId)
      .executeTakeFirst();
    return row ? toPreference(row) : undefined;
  }

  async findSame(userId: string, category: PreferenceCategory, content: string): Promise<UserPreference | undefined> {
    const row = await this.db.selectFrom("user_preferences")
      .selectAll()
      .where("user_id", "=", userId)
      .where("category", "=", category)
      .where("content", "=", content)
      .executeTakeFirst();
    return row ? toPreference(row) : undefined;
  }

  async create(input: Parameters<PreferenceRepository["create"]>[0]): Promise<UserPreference> {
    const now = nowIso();
    const preferenceId = randomUUID();
    await this.db.insertInto("user_preferences").values({
      preference_id: preferenceId,
      user_id: input.userId,
      category: input.category,
      content: input.content,
      source_session_id: input.source.sessionId,
      source_message_id: input.source.messageId,
      source_quote: input.source.quote,
      version: 1,
      created_at: now,
      updated_at: now,
    }).execute();
    return (await this.findById(input.userId, preferenceId))!;
  }

  async update(input: Parameters<PreferenceRepository["update"]>[0]): Promise<PreferenceMutationResult> {
    const current = await this.findById(input.userId, input.preferenceId);
    if (!current) return { kind: "not_found" };
    if (current.version !== input.expectedVersion) return { kind: "conflict", preference: current };
    const result = await this.db.updateTable("user_preferences")
      .set({
        category: input.category,
        content: input.content,
        source_session_id: input.source.sessionId,
        source_message_id: input.source.messageId,
        source_quote: input.source.quote,
        version: input.expectedVersion + 1,
        updated_at: nowIso(),
      })
      .where("user_id", "=", input.userId)
      .where("preference_id", "=", input.preferenceId)
      .where("version", "=", input.expectedVersion)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) {
      const latest = await this.findById(input.userId, input.preferenceId);
      return latest ? { kind: "conflict", preference: latest } : { kind: "not_found" };
    }
    return { kind: "ok", preference: (await this.findById(input.userId, input.preferenceId))! };
  }

  async delete(input: Parameters<PreferenceRepository["delete"]>[0]): Promise<PreferenceMutationResult> {
    const current = await this.findById(input.userId, input.preferenceId);
    if (!current) return { kind: "not_found" };
    if (current.version !== input.expectedVersion) return { kind: "conflict", preference: current };
    const result = await this.db.deleteFrom("user_preferences")
      .where("user_id", "=", input.userId)
      .where("preference_id", "=", input.preferenceId)
      .where("version", "=", input.expectedVersion)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) !== 1) {
      const latest = await this.findById(input.userId, input.preferenceId);
      return latest ? { kind: "conflict", preference: latest } : { kind: "not_found" };
    }
    return { kind: "ok", preference: current };
  }
}
