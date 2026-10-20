import { z } from "zod";
import { sql, type Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { MediaService } from "../media/index.js";
export class UserProfileError extends Error {
  constructor(readonly code: "VERSION_CONFLICT" | "INVALID_AVATAR" | "INVALID_COVER", readonly status: 409 | 422) {
    super(code === "VERSION_CONFLICT" ? "个人信息已更新，请核对后重试。" : code === "INVALID_COVER" ? "背景图无效，请重新选择图片。" : "头像无效，请重新选择图片。");
  }
}
const line = (max: number, required = false) => z.string().trim().refine(value => [...value].length <= max && (!required || value.length > 0) && !/[\p{Cc}\p{Cf}]/u.test(value));
export const profilePatch = z.object({
  expectedVersion: z.number().int().nonnegative(),
  changes: z.object({nickname: line(30, true).optional(), signature: line(40).optional(), avatarMediaId: z.string().min(1).max(200).nullable().optional(), coverMediaId: z.string().min(1).max(200).nullable().optional()}).strict().refine(value => Object.keys(value).length > 0),
}).strict();
export const statsTimeZone = z.string().min(1).max(100).default("UTC").refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "时区无效");

export function companionDaysSince(joinedAt: Date, now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "numeric", day: "numeric" });
  const day = (date: Date) => {
    const parts = formatter.formatToParts(date);
    const value = (type: string) => Number(parts.find(part => part.type === type)!.value);
    return Date.UTC(value("year"), value("month") - 1, value("day")) / 86400000;
  };
  return Math.max(1, day(now) - day(joinedAt) + 1);
}

export class UserProfileService {
  constructor(private readonly db: Kysely<DB>, private readonly media: MediaService) {}
  async getStatistics(userId: string, timeZone = "UTC") {
    const asOf = new Date();
    const user = await this.db.selectFrom("users").select([
      "created_at",
      sql<string>`(SELECT COUNT(*) FROM records WHERE owner_type = 'user' AND owner_id = ${userId})`.as("record_count"),
    ]).where("user_id", "=", userId).executeTakeFirstOrThrow();
    return {
      companionDays: companionDaysSince(user.created_at, asOf, timeZone),
      recordCount: Number(user.record_count),
      intimacy: 12,
      intimacyIsPlaceholder: true,
      asOf: asOf.toISOString(),
    };
  }
  async get(userId: string) {
    const user = await this.db.selectFrom("users").select("created_at").where("user_id", "=", userId).executeTakeFirstOrThrow();
    const row = await this.db.selectFrom("user_profiles").selectAll().where("user_id", "=", userId).executeTakeFirst();
    return {nickname: row?.nickname ?? "你", signature: row?.signature ?? "", avatarMediaId: row?.avatar_media_id ?? null, coverMediaId: row?.cover_media_id ?? null, version: row?.version ?? 0, joinedAt: user.created_at.toISOString()};
  }
  async update(userId: string, input: z.infer<typeof profilePatch>) {
    return this.db.transaction().execute(async trx => {
      const user = await trx.selectFrom("users").select("created_at").where("user_id", "=", userId).forUpdate().executeTakeFirstOrThrow();
      const row = await trx.selectFrom("user_profiles").selectAll().where("user_id", "=", userId).forUpdate().executeTakeFirst();
      if (input.expectedVersion !== (row?.version ?? 0)) throw new UserProfileError("VERSION_CONFLICT", 409);
      const changes = input.changes;
      if (changes.avatarMediaId && changes.avatarMediaId !== row?.avatar_media_id && !await this.media.validateAvatar(userId, changes.avatarMediaId, trx, "user_avatar")) throw new UserProfileError("INVALID_AVATAR", 422);
      if (changes.coverMediaId && changes.coverMediaId !== row?.cover_media_id && !await this.media.validateAvatar(userId, changes.coverMediaId, trx, "user_cover")) throw new UserProfileError("INVALID_COVER", 422);
      const next = {nickname: changes.nickname ?? row?.nickname ?? "你", signature: changes.signature ?? row?.signature ?? "", avatarMediaId: changes.avatarMediaId === undefined ? row?.avatar_media_id ?? null : changes.avatarMediaId, coverMediaId: changes.coverMediaId === undefined ? row?.cover_media_id ?? null : changes.coverMediaId};
      const unchanged = row && next.nickname === row.nickname && next.signature === row.signature && next.avatarMediaId === row.avatar_media_id && next.coverMediaId === row.cover_media_id;
      const version = unchanged ? row.version : (row?.version ?? 0) + 1;
      if (!unchanged) {
        const values = {nickname: next.nickname, signature: next.signature, avatar_media_id: next.avatarMediaId, cover_media_id: next.coverMediaId, version, updated_at: new Date()};
        await trx.insertInto("user_profiles").values({user_id: userId, ...values}).onConflict(oc => oc.column("user_id").doUpdateSet(values)).execute();
        for (const [oldId, newId] of [[row?.avatar_media_id, next.avatarMediaId], [row?.cover_media_id, next.coverMediaId]]) {
          if (!oldId || oldId === newId) continue;
          const old = await trx.selectFrom("media_assets").select("ext_data").where("user_id", "=", userId).where("media_id", "=", oldId).forUpdate().executeTakeFirst();
          if (old) await trx.updateTable("media_assets").set({ext_data: JSON.stringify({...JSON.parse(old.ext_data ?? "{}"), retiredAt: new Date().toISOString()})}).where("user_id", "=", userId).where("media_id", "=", oldId).execute();
        }
      }
      return {...next, version, joinedAt: user.created_at.toISOString()};
    });
  }
}
