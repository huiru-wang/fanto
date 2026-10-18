import { z } from "zod";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { MediaService } from "../media/index.js";
export class UserProfileError extends Error {
  constructor(readonly code: "VERSION_CONFLICT" | "INVALID_AVATAR", readonly status: 409 | 422) {
    super(code === "VERSION_CONFLICT" ? "个人信息已更新，请核对后重试。" : "头像无效，请重新选择图片。");
  }
}
const line = (max: number, required = false) => z.string().trim().refine(value => [...value].length <= max && (!required || value.length > 0) && !/[\p{Cc}\p{Cf}]/u.test(value));
export const profilePatch = z.object({
  expectedVersion: z.number().int().nonnegative(),
  changes: z.object({nickname: line(30, true).optional(), signature: line(40).optional(), avatarMediaId: z.string().min(1).max(200).nullable().optional()}).strict().refine(value => Object.keys(value).length > 0),
}).strict();
export class UserProfileService {
  constructor(private readonly db: Kysely<DB>, private readonly media: MediaService) {}
  async get(userId: string) {
    const user = await this.db.selectFrom("users").select("created_at").where("user_id", "=", userId).executeTakeFirstOrThrow();
    const row = await this.db.selectFrom("user_profiles").selectAll().where("user_id", "=", userId).executeTakeFirst();
    return {nickname: row?.nickname ?? "你", signature: row?.signature ?? "", avatarMediaId: row?.avatar_media_id ?? null, version: row?.version ?? 0, joinedAt: user.created_at.toISOString()};
  }
  async update(userId: string, input: z.infer<typeof profilePatch>) {
    return this.db.transaction().execute(async trx => {
      const user = await trx.selectFrom("users").select("created_at").where("user_id", "=", userId).forUpdate().executeTakeFirstOrThrow();
      const row = await trx.selectFrom("user_profiles").selectAll().where("user_id", "=", userId).forUpdate().executeTakeFirst();
      if (input.expectedVersion !== (row?.version ?? 0)) throw new UserProfileError("VERSION_CONFLICT", 409);
      const changes = input.changes;
      if (changes.avatarMediaId && changes.avatarMediaId !== row?.avatar_media_id && !await this.media.validateAvatar(userId, changes.avatarMediaId, trx, "user_avatar")) throw new UserProfileError("INVALID_AVATAR", 422);
      const next = {nickname: changes.nickname ?? row?.nickname ?? "你", signature: changes.signature ?? row?.signature ?? "", avatarMediaId: changes.avatarMediaId === undefined ? row?.avatar_media_id ?? null : changes.avatarMediaId};
      const unchanged = row && next.nickname === row.nickname && next.signature === row.signature && next.avatarMediaId === row.avatar_media_id;
      const version = unchanged ? row.version : (row?.version ?? 0) + 1;
      if (!unchanged) {
        const values = {nickname: next.nickname, signature: next.signature, avatar_media_id: next.avatarMediaId, version, updated_at: new Date()};
        await trx.insertInto("user_profiles").values({user_id: userId, ...values}).onConflict(oc => oc.column("user_id").doUpdateSet(values)).execute();
        if (row?.avatar_media_id && row.avatar_media_id !== next.avatarMediaId) {
          const old = await trx.selectFrom("media_assets").select("ext_data").where("user_id", "=", userId).where("media_id", "=", row.avatar_media_id).forUpdate().executeTakeFirst();
          if (old) await trx.updateTable("media_assets").set({ext_data: JSON.stringify({...JSON.parse(old.ext_data ?? "{}"), retiredAt: new Date().toISOString()})}).where("user_id", "=", userId).where("media_id", "=", row.avatar_media_id).execute();
        }
      }
      return {...next, version, joinedAt: user.created_at.toISOString()};
    });
  }
}
