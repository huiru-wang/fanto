import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import { defaultSettings, emptyRole, FantoError, type FantoSettings, type SettingsChanges } from "./model.js";
export type AvatarValidator = (userId: string, mediaId: string, trx: Transaction<DB>) => Promise<boolean>;
export class PostgresFantoRepository {
    constructor(private readonly db: Kysely<DB>) { }
    async find(userId: string): Promise<FantoSettings | null> {
        const row = await this.db.selectFrom("user_fanto_settings").selectAll().where("user_id", "=", userId).orderBy("created_at").orderBy("fanto_id").limit(1).executeTakeFirst();
        return row ? { fantoId: row.fanto_id, nickname: row.nickname, description: row.description, avatarMediaId: row.avatar_media_id, sessionId: row.session_id,
            roleConfig: { ...emptyRole(), ...row.role_config }, version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() } : null;
    }
    async update(userId: string, expectedVersion: number | null, changes: SettingsChanges, validate: AvatarValidator): Promise<FantoSettings> {
        return this.db.transaction().execute(async (trx) => {
            // Lock the user first, including when a settings row does not exist yet.
            await trx.selectFrom("users").select("user_id").where("user_id", "=", userId).forUpdate().executeTakeFirstOrThrow();
            const row = await trx.selectFrom("user_fanto_settings").selectAll().where("user_id", "=", userId).orderBy("created_at").orderBy("fanto_id").limit(1).forUpdate().executeTakeFirst();
            if (expectedVersion !== null && expectedVersion !== (row?.version ?? 0))
                throw new FantoError("VERSION_CONFLICT", 409);
            const current = row ? { fantoId: row.fanto_id, nickname: row.nickname, description: row.description, avatarMediaId: row.avatar_media_id, sessionId: row.session_id, roleConfig: { ...emptyRole(), ...row.role_config } } : defaultSettings();
            if (changes.avatarMediaId && changes.avatarMediaId !== row?.avatar_media_id && !await validate(userId, changes.avatarMediaId, trx))
                throw new FantoError("INVALID_AVATAR", 422);
            const next = { fantoId: row?.fanto_id ?? randomUUID(), nickname: changes.nickname ?? current.nickname, description: changes.description ?? current.description,
                avatarMediaId: changes.avatarMediaId === undefined ? current.avatarMediaId : changes.avatarMediaId,
                sessionId: changes.sessionId === undefined ? current.sessionId : changes.sessionId,
                roleConfig: { ...current.roleConfig, ...changes.roleConfig } };
            if (row && next.nickname === row.nickname && next.description === row.description && next.avatarMediaId === row.avatar_media_id && next.sessionId === row.session_id &&
                JSON.stringify(Object.entries(next.roleConfig).sort()) === JSON.stringify(Object.entries(current.roleConfig).sort()))
                return { ...current, version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
            const now = new Date();
            await trx.insertInto("user_fanto_settings").values({ fanto_id: next.fantoId, user_id: userId, nickname: next.nickname, description: next.description, avatar_media_id: next.avatarMediaId, session_id: next.sessionId,
                role_config: JSON.stringify(next.roleConfig), version: (row?.version ?? 0) + 1, created_at: row?.created_at ?? now, updated_at: now })
                .onConflict(oc => oc.column("fanto_id").doUpdateSet({ nickname: next.nickname, description: next.description, avatar_media_id: next.avatarMediaId, session_id: next.sessionId,
                role_config: JSON.stringify(next.roleConfig), version: (row?.version ?? 0) + 1, updated_at: now })).execute();
            if (row?.avatar_media_id && row.avatar_media_id !== next.avatarMediaId) {
                const old = await trx.selectFrom("media_assets").selectAll().where("user_id", "=", userId).where("media_id", "=", row.avatar_media_id).forUpdate().executeTakeFirst();
                if (old)
                    await trx.updateTable("media_assets").set({ ext_data: JSON.stringify({ ...JSON.parse(old.ext_data ?? "{}"), retiredAt: now.toISOString() }) }).where("user_id", "=", userId).where("media_id", "=", old.media_id).execute();
            }
            return { ...next, version: (row?.version ?? 0) + 1, createdAt: (row?.created_at ?? now).toISOString(), updatedAt: now.toISOString() };
        });
    }
}
