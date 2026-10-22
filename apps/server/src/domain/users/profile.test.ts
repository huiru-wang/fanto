import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "kysely";
import { randomUUID } from "node:crypto";
import { createDatabase, runMigrations } from "../../infrastructure/database/database.js";
import { UserProfileService, profilePatch } from "./profile-service.js";
import { MediaService } from "../media/index.js";
import { FantoService } from "../fanto/index.js";
import { MemoryStorage } from "../media/testing/memory-storage.js";
import { createApp, logSafeBody } from "../../bootstrap/app.js";

test("profile accepts only single-line bounded fields and redacts account data", () => {
  for (const changes of [{nickname: ""}, {nickname: "a\nb"}, {signature: "x".repeat(41)}, {signature: "a\nb"}, {userId: "other"}, {}, {nickname: "a\u200bb"}]) {
    assert.equal(profilePatch.safeParse({expectedVersion: 0, changes}).success, false);
  }
  assert.equal(profilePatch.safeParse({expectedVersion: 0, changes: {nickname: "😀".repeat(30), avatarMediaId: null, signature: ""}}).success, true);
  assert.equal(logSafeBody("/api/users/me/profile", {signature: "private"}), "[REDACTED]");
});
test("profile route authenticates before accessing the service", async () => {
  const service = {get: async (id: string) => ({nickname: id}), update: async (id: string) => ({nickname: id})};
  const app = createApp({userProfile: service as unknown as UserProfileService, records: {} as never, media: {} as never, auth: {sessions: { verify: async (userId: string) => ({userId}) }, assertActiveUser: async () => {}} as never});
  assert.equal((await app.request("/api/users/me/profile")).status, 401);
  const response = await app.request("/api/users/me/profile", {headers: {Authorization: "Bearer owner"}});
  assert.equal((await response.json() as any).result.nickname, "owner");
  assert.equal((await app.request("/api/users/me/profile", {method: "PATCH", headers: {Authorization: "Bearer owner", "Content-Type": "application/json"}, body: JSON.stringify({expectedVersion: 0, changes: {userId: "other"}})})).status, 400);
});
test("profile writes isolate accounts, reject role avatars, enforce versions and protect active avatars from cleanup", {skip: !process.env.TEST_DATABASE_URL}, async () => {
  const admin = createDatabase(process.env.TEST_DATABASE_URL!);
  const databaseName = `profile_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${databaseName}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${databaseName}`;
  const db = createDatabase(url.toString());
  const users = [randomUUID(), randomUUID()];
  try {
    await runMigrations(db);
    const now = new Date();
    await db.insertInto("users").values(users.map(user_id => ({user_id, status: "active", created_at: now, updated_at: now, disabled_at: null}))).execute();
    const media = MediaService.create(db, new MemoryStorage()), service = new UserProfileService(db, media), fanto = FantoService.create(db, media);
    const owner = users[0]!;
    assert.equal((await service.get(owner)).version, 0);
    const results = await Promise.allSettled(["Robin", "Another"].map(nickname => service.update(owner, {expectedVersion: 0, changes: {nickname}})));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    let current = await service.get(owner);
    assert.equal((await service.get(users[1]!)).nickname, "你");
    const avatar = async (user: string, purpose: string) => {
      const id = randomUUID(), old = new Date(Date.now() - 48 * 3600000).toISOString();
      await db.insertInto("media_assets").values({media_id: id, user_id: user, object_key: `users/${user}/profile/avatar/${id}.jpg`, media_type: "image", mime_type: "image/jpeg", bytes: 100, status: "ready", ext_data: JSON.stringify({purpose}), created_at: old, updated_at: old}).execute();
      return id;
    };
    for (const id of [await avatar(users[1]!, "user_avatar"), await avatar(owner, "fanto_avatar")]) {
      await assert.rejects(service.update(owner, {expectedVersion: current.version, changes: {avatarMediaId: id}}), {code: "INVALID_AVATAR"});
    }
    const id = await avatar(owner, "user_avatar");
    current = await service.update(owner, {expectedVersion: current.version, changes: {avatarMediaId: id, signature: "一句话"}});
    const cover = await avatar(owner, "user_cover");
    await assert.rejects(service.update(owner, {expectedVersion: current.version, changes: {coverMediaId: id}}), {code: "INVALID_COVER"});
    await assert.rejects(service.update(owner, {expectedVersion: current.version, changes: {coverMediaId: await avatar(users[1]!, "user_cover")}}), {code: "INVALID_COVER"});
    await assert.rejects(service.update(owner, {expectedVersion: current.version, changes: {avatarMediaId: cover}}), {code: "INVALID_AVATAR"});
    current = await service.update(owner, {expectedVersion: current.version, changes: {coverMediaId: cover}});
    assert.equal(current.coverMediaId, cover);
    await assert.rejects(fanto.create(owner, {nickname: "role-avatar-test", avatarMediaId: id}), {code: "INVALID_AVATAR"});
    await assert.rejects(service.update(owner, {expectedVersion: current.version - 1, changes: {nickname: "stale"}}), {code: "VERSION_CONFLICT"});
    await media.cleanupAvatars(db, true);
    assert.ok(await db.selectFrom("media_assets").select("media_id").where("media_id", "=", id).executeTakeFirst());
    assert.ok(await db.selectFrom("media_assets").select("media_id").where("media_id", "=", cover).executeTakeFirst());
    current = await service.update(owner, {expectedVersion: current.version, changes: {avatarMediaId: null}});
    await assert.rejects(service.update(owner, {expectedVersion: current.version, changes: {avatarMediaId: id}}), {code: "INVALID_AVATAR"});
    await media.cleanupAvatars(db, true);
    assert.equal(await db.selectFrom("media_assets").select("media_id").where("media_id", "=", id).executeTakeFirst(), undefined);
    current = await service.update(owner, {expectedVersion: current.version, changes: {coverMediaId: null}});
    await assert.rejects(service.update(owner, {expectedVersion: current.version, changes: {coverMediaId: cover}}), {code: "INVALID_COVER"});
    await media.cleanupAvatars(db, true);
    assert.equal(await db.selectFrom("media_assets").select("media_id").where("media_id", "=", cover).executeTakeFirst(), undefined);
    const active = await avatar(owner, "user_avatar");
    await service.update(owner, {expectedVersion: current.version, changes: {avatarMediaId: active}});
    // No SQL cascade: callers must explicitly clean account resources.
    await db.deleteFrom("user_profiles").where("user_id", "=", owner).execute();
    await db.deleteFrom("users").where("user_id", "=", owner).execute();
    assert.equal(await db.selectFrom("user_profiles").selectAll().where("user_id", "=", owner).executeTakeFirst(), undefined);
  } finally {
    await db.deleteFrom("users").where("user_id", "in", users).execute();
    await db.destroy();
    await sql.raw(`DROP DATABASE ${databaseName} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
