import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import test from "node:test";
import { createApp } from "../../bootstrap/app.js";
import { SqliteMediaRepository } from "../media/sqlite-repository.js";
import { SqliteRecordRepository } from "../records/sqlite-repository.js";
import { createDatabase, runMigrations } from "../../infrastructure/database/database.js";
import { RecordPostprocessQueue } from "../../infrastructure/queue/record-postprocess-queue.js";
import { nowIso } from "../../infrastructure/time.js";
import { SqlitePreferenceRepository } from "./sqlite-repository.js";
import { PreferenceService } from "./preference-service.js";

test("preference HTTP contract preserves user isolation, provenance and optimistic versioning", async () => {
  const path = `/tmp/fanto-preference-${randomUUID()}.sqlite`;
  const db = createDatabase(path);
  await runMigrations(db);
  const userId = "preference-user";
  const otherUserId = "preference-other";
  const now = nowIso();
  try {
    await db.insertInto("users").values([
      { user_id: userId, wx_openid: userId, created_at: now },
      { user_id: otherUserId, wx_openid: otherUserId, created_at: now },
    ]).execute();
    const preferences = new PreferenceService(new SqlitePreferenceRepository(db));
    const app = createApp(
      new SqliteRecordRepository(db),
      new SqliteMediaRepository(db),
      new RecordPostprocessQueue(),
      { readUrl: () => "https://private.example", putUrl: () => "https://upload.example" } as any,
      undefined, undefined, undefined, undefined, preferences,
    );
    const auth = { "x-user-id": userId, "content-type": "application/json" };
    const source = { sessionId: "session-1", messageId: "message-1", quote: "以后技术方案详细一点" };

    const createdResponse = await app.request("/api/preferences", {
      method: "POST", headers: auth,
      body: JSON.stringify({ category: "communication", content: "技术方案详细展开", source }),
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json() as any).result.preference;
    assert.equal(created.version, 1);
    assert.equal(created.sourceQuote, source.quote);

    const reusedResponse = await app.request("/api/preferences", {
      method: "POST", headers: auth,
      body: JSON.stringify({
        category: "communication", content: "技术方案详细展开",
        source: { sessionId: "session-2", messageId: "message-2", quote: "技术方案以后都详细讲" },
      }),
    });
    assert.equal(reusedResponse.status, 200);
    const reused = (await reusedResponse.json() as any).result;
    assert.equal(reused.reused, true);
    assert.equal(reused.preference.preferenceId, created.preferenceId);
    assert.equal(reused.preference.version, 2);
    assert.equal(reused.preference.sourceSessionId, "session-2");

    const conflict = await app.request(`/api/preferences/${created.preferenceId}`, {
      method: "PATCH", headers: auth,
      body: JSON.stringify({ expectedVersion: 1, category: "communication", content: "简短回答", source }),
    });
    assert.equal(conflict.status, 409);

    const updatedResponse = await app.request(`/api/preferences/${created.preferenceId}`, {
      method: "PATCH", headers: auth,
      body: JSON.stringify({ expectedVersion: 2, category: "scenario", content: "技术讨论时详细展开", source }),
    });
    const updated = (await updatedResponse.json() as any).result;
    assert.equal(updated.version, 3);
    assert.equal(updated.category, "scenario");

    const otherList = await app.request("/api/preferences", { headers: { "x-user-id": otherUserId } });
    assert.deepEqual((await otherList.json() as any).result.data, []);

    const deleted = await app.request(`/api/preferences/${created.preferenceId}`, {
      method: "DELETE", headers: auth, body: JSON.stringify({ expectedVersion: 3 }),
    });
    assert.equal(deleted.status, 200);
    const list = await app.request("/api/preferences", { headers: { "x-user-id": userId } });
    assert.deepEqual((await list.json() as any).result.data, []);


    for (let index = 0; index < 20; index += 1) {
      const response = await app.request("/api/preferences", {
        method: "POST", headers: auth,
        body: JSON.stringify({
          category: "scenario",
          content: "场景偏好-" + index,
          source: { sessionId: "limit-session", messageId: "limit-message-" + index, quote: "偏好-" + index },
        }),
      });
      assert.equal(response.status, 201);
    }
    const overflow = await app.request("/api/preferences", {
      method: "POST", headers: auth,
      body: JSON.stringify({
        category: "scenario",
        content: "第21条偏好",
        source: { sessionId: "limit-session", messageId: "limit-message-21", quote: "第21条偏好" },
      }),
    });
    assert.equal(overflow.status, 409);
    assert.equal((await overflow.json() as any).errorCode, "PREFERENCE_LIMIT_REACHED");
  } finally {
    await db.destroy();
    await rm(path, { force: true });
    await rm(`${path}-wal`, { force: true });
    await rm(`${path}-shm`, { force: true });
  }
});
