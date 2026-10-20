import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { UserProfileService, companionDaysSince } from "./profile-service.js";
import { createApp } from "../../bootstrap/app.js";
import { createDatabase, runMigrations } from "../../infrastructure/database/database.js";

const now = new Date("2026-10-19T00:15:00Z");
test("companion days count local calendar dates, include registration day and handle DST", () => {
  const joined = new Date("2026-10-18T23:30:00Z");
  assert.equal(companionDaysSince(joined, now, "UTC"), 2);
  assert.equal(companionDaysSince(joined, now, "Asia/Shanghai"), 1);
  assert.equal(companionDaysSince(now, now, "UTC"), 1);
  assert.equal(companionDaysSince(new Date("2027-01-01"), now, "UTC"), 1);
  assert.equal(companionDaysSince(new Date("2026-03-07T17:00:00Z"), new Date("2026-03-09T16:00:00Z"), "America/New_York"), 3);
});

test("statistics HTTP requires JWT and uses the authenticated identity with validated time zone", async () => {
  const calls: string[][] = [];
  const result = { companionDays: 2, recordCount: 64, intimacy: 12, intimacyIsPlaceholder: true, asOf: now.toISOString() };
  const service = { getStatistics: async (userId: string, timeZone: string) => {
    calls.push([userId, timeZone]); return result;
  } } as unknown as UserProfileService;
  const app = createApp({ userProfile: service, records: {} as never, media: {} as never,
    auth: { verifyAccess: async (userId: string) => ({userId}), assertActiveUser: async () => {} } as never });
  assert.equal((await app.request("/api/users/me/statistics")).status, 401);
  const headers = { Authorization: "Bearer owner" };
  const response = await app.request("/api/users/me/statistics?timeZone=Asia%2FShanghai&userId=other", {headers});
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as any).result, result);
  assert.deepEqual(calls, [["owner", "Asia/Shanghai"]]);
  assert.equal((await app.request("/api/users/me/statistics?timeZone=invalid-zone", {headers})).status, 400);
  assert.equal(calls.length, 1);
  await app.request("/api/users/me/statistics", {headers});
  assert.deepEqual(calls.at(-1), ["owner", "UTC"]);
});

test("statistics count all retained records for only the authenticated user, including unprocessed records", {skip: !process.env.TEST_DATABASE_URL}, async () => {
  const testURL = process.env.TEST_DATABASE_URL!;
  if (!/test/i.test(new URL(testURL).pathname)) throw new Error("Dedicated test database required");
  const admin = createDatabase(testURL);
  const name = `user_stats_test_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(testURL); url.pathname = `/${name}`;
  const db = createDatabase(url.href);
  try {
    await runMigrations(db);
    const owner = randomUUID(), other = randomUUID(), joined = new Date("2026-01-01T00:00:00Z");
    await db.insertInto("users").values([owner, other].map(user_id => ({user_id, status: "active", created_at: joined, updated_at: joined, disabled_at: null}))).execute();
    const service = new UserProfileService(db, {} as never);
    assert.equal((await service.getStatistics(owner)).recordCount, 0);
    const add = async (userId: string, status: string) => {
      const id = randomUUID(), stamp = new Date().toISOString();
      await sql`INSERT INTO records (record_id,owner_type,owner_id,source,content,version,status,event_at,created_at,updated_at)
        VALUES (${id},'user',${userId},'home','{"text":"test","blocks":[]}',1,${status},${stamp},${stamp},${stamp})`.execute(db);
      return id;
    };
    const first = await add(owner, "pending");
    await add(owner, "processed"); await add(owner, "failed"); await add(other, "processed");
    const stats = await service.getStatistics(owner, "Asia/Shanghai");
    assert.equal(stats.recordCount, 3);
    assert.equal(stats.companionDays, companionDaysSince(joined, new Date(stats.asOf), "Asia/Shanghai"));
    assert.equal(stats.intimacy, 12); assert.equal(stats.intimacyIsPlaceholder, true);
    assert.equal((await service.getStatistics(other)).recordCount, 1);
    await db.deleteFrom("records").where("record_id", "=", first).where("owner_type", "=", "user").where("owner_id", "=", owner).execute();
    assert.equal((await service.getStatistics(owner)).recordCount, 2);
  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
