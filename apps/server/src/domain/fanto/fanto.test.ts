import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { FantoService, defaultSettings, settingsPatchSchema } from "./index.js";
import { createApp, logSafeBody } from "../../bootstrap/app.js";
import { createDatabase, runMigrations } from "../../infrastructure/database/database.js";
import { MediaService } from "../media/index.js";
import { MemoryStorage } from "../media/testing/memory-storage.js";
import { sql } from "kysely";
test("settings patches reject invalid shapes and preserve explicit clear semantics", () => {
    for (const input of [null, {}, { expectedVersion: 0, changes: {} }, { expectedVersion: 0, changes: { roleConfig: {} } }, { expectedVersion: 0, changes: { roleConfig: null } }, { expectedVersion: 0, changes: { roleConfig: { character: 3 } } }, { expectedVersion: 0, changes: { userId: "other" } }, { expectedVersion: 0, changes: { roleConfig: { newField: "x" } } }, { expectedVersion: 0, changes: { nickname: "\n" } }, { expectedVersion: 0, changes: { roleConfig: { character: "😀".repeat(8001) } } }])
        assert.equal(settingsPatchSchema.safeParse(input).success, false);
    assert.equal(settingsPatchSchema.safeParse({ expectedVersion: 0, changes: { roleConfig: { character: "" }, avatarMediaId: null } }).success, true);
    assert.equal(settingsPatchSchema.safeParse({ expectedVersion: 0, changes: { nickname: "😀".repeat(30) } }).success, true);
    assert.equal(logSafeBody("/api/fanto/settings", { nickname: "private" }), "[REDACTED]");
    assert.equal(logSafeBody("/api/fanto/settings/", { roleConfig: { character: "private" } }), "[REDACTED]");
});
test("settings HTTP requires JWT, validates identity and never returns a database failure as defaults", async () => {
    const service = new FantoService({ find: async () => null, update: async () => { throw new Error("database failed"); } }, { validateAvatar: async () => false });
    const app = createApp({ fanto: service, records: {} as never, media: {} as never, auth: { verifyAccess: async (userId: string) => ({ userId }), assertActiveUser: async () => { } } as never });
    assert.equal((await app.request("/api/fanto/settings")).status, 401);
    const headers = { Authorization: "Bearer owner", "Content-Type": "application/json" };
    const response = await app.request("/api/fanto/settings", { headers });
    assert.deepEqual((await response.json() as any).result, defaultSettings());
    assert.equal((await app.request("/api/fanto/settings", { method: "PATCH", headers, body: JSON.stringify({ expectedVersion: 0, changes: { userId: "other" } }) })).status, 400);
    assert.equal((await app.request("/api/fanto/settings", { method: "PATCH", headers, body: JSON.stringify({ expectedVersion: 0, changes: { nickname: "new" } }) })).status, 500);
});
test("Fanto PostgreSQL singleton, optimistic writes, JSON preservation, avatar isolation and retirement", { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const db = createDatabase(process.env.TEST_DATABASE_URL!), storage = new MemoryStorage(), users = [randomUUID(), randomUUID()];
    try {
        await runMigrations(db);
        const now = new Date();
        await db.insertInto("users").values(users.map(user_id => ({ user_id, status: "active", created_at: now, updated_at: now, disabled_at: null }))).execute();
        const media = MediaService.create(db, storage), service = FantoService.create(db, media), owner = users[0]!;
        assert.equal((await service.getSettings(owner)).version, 0);
        const first = await Promise.allSettled([service.updateSettings(owner, { expectedVersion: 0, changes: { nickname: "first" } }), service.updateSettings(owner, { expectedVersion: 0, changes: { nickname: "second" } })]);
        assert.equal(first.filter(x => x.status === "fulfilled").length, 1);
        let current = await service.getSettings(owner);
        await sql `UPDATE user_fanto_settings SET role_config=role_config || '{"futureOption":"keep"}'::jsonb WHERE user_id=${owner}`.execute(db);
        current = await service.updateSettings(owner, { expectedVersion: current.version, changes: { roleConfig: { character: "A\n\nB" } } });
        assert.equal(current.roleConfig.futureOption, "keep");
        assert.equal(current.roleConfig.character, "A\n\nB");
        const oldVersion = current.version;
        await service.replaceLegacyCharacter(owner, { character: "legacy", scenario: "", instructions: "", exampleDialogues: "" });
        await assert.rejects(service.updateSettings(owner, { expectedVersion: oldVersion, changes: { description: "stale" } }), { code: "VERSION_CONFLICT" });
        current = await service.getSettings(owner);
        assert.equal(current.roleConfig.futureOption, "keep");
        assert.equal((await service.getSettings(users[1]!)).version, 0);
        const make = async (user: string, purpose: string) => { const id = randomUUID(), key = `users/${user}/fanto/avatar/${id}.jpg`, stamp = new Date().toISOString(); await db.insertInto("media_assets").values({ media_id: id, user_id: user, object_key: key, media_type: "image", mime_type: "image/jpeg", bytes: 100, status: "ready", ext_data: JSON.stringify({ purpose }), created_at: stamp, updated_at: stamp }).execute(); return id; };
        for (const id of [await make(users[1]!, "fanto_avatar"), await make(owner, "record")])
            await assert.rejects(service.updateSettings(owner, { expectedVersion: current.version, changes: { avatarMediaId: id } }), { code: "INVALID_AVATAR" });
        const avatar = await make(owner, "fanto_avatar");
        current = await service.updateSettings(owner, { expectedVersion: current.version, changes: { avatarMediaId: avatar } });
        current = await service.updateSettings(owner, { expectedVersion: current.version, changes: { avatarMediaId: null } });
        const old = await db.selectFrom("media_assets").selectAll().where("media_id", "=", avatar).executeTakeFirstOrThrow();
        assert.ok(JSON.parse(old.ext_data!).retiredAt);
        await assert.rejects(service.updateSettings(owner, { expectedVersion: current.version, changes: { avatarMediaId: avatar } }), { code: "INVALID_AVATAR" });
        const activeAvatar = await make(owner, "fanto_avatar");
        current = await service.updateSettings(owner, { expectedVersion: current.version, changes: { avatarMediaId: activeAvatar } });
        await db.updateTable("media_assets").set({ created_at: new Date(Date.now() - 48 * 3600000).toISOString() }).where("media_id", "in", [avatar, activeAvatar]).execute();
        assert.equal((await media.cleanupAvatars(db)).eligible, 1);
        assert.ok(await db.selectFrom("media_assets").select("media_id").where("media_id", "=", avatar).executeTakeFirst());
        assert.equal((await media.cleanupAvatars(db, true)).removed, 1);
        assert.ok(await db.selectFrom("media_assets").select("media_id").where("media_id", "=", activeAvatar).executeTakeFirst());
        await db.deleteFrom("users").where("user_id", "=", owner).execute();
        assert.equal((await db.selectFrom("user_fanto_settings").selectAll().where("user_id", "=", owner).execute()).length, 0);
    }
    finally {
        await db.deleteFrom("user_fanto_settings").where("user_id", "in", users).execute();
        await db.deleteFrom("users").where("user_id", "in", users).execute();
        await db.destroy();
    }
});
