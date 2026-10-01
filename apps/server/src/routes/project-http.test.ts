import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nodeTest from "node:test";
import { createApp } from "../bootstrap/app.js";
import { MediaService } from "../domain/media/index.js";
import { ProjectService } from "../domain/projects/index.js";
import { RecordService } from "../domain/records/index.js";
import { createDatabase, runMigrations } from "../infrastructure/database/database.js";
import { RecordPostprocessQueue } from "../infrastructure/queue/record-postprocess-queue.js";

const test = process.env.TEST_DATABASE_URL ? nodeTest : nodeTest.skip;

test("project HTTP routes expose projects and cursor-paged records", async () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL!);
  await runMigrations(db);
  const userId = randomUUID();
  const projectId = randomUUID();
  const proposedId = randomUUID();
  const rejectedId = randomUUID();
  const now = new Date();
  const recordIds = Array.from({ length: 7 }, () => randomUUID());

  try {
    await db.insertInto("users").values({ user_id: userId, status: "active", created_at: now, updated_at: now, disabled_at: null }).execute();
    await db.insertInto("projects").values([
      { project_id: projectId, user_id: userId, title: "AI 眼镜", content: "长期脉络", status: "active", version: 1, ext_data: {}, created_at: now, updated_at: now },
      { project_id: proposedId, user_id: userId, title: "候选脉络", content: "等待确认", status: "proposed", version: 1, ext_data: {}, created_at: now, updated_at: now },
      { project_id: rejectedId, user_id: userId, title: "另一个候选", content: "等待拒绝", status: "proposed", version: 1, ext_data: {}, created_at: now, updated_at: now },
    ]).execute();

    for (const [index, recordId] of recordIds.entries()) {
      const eventAt = new Date(now.getTime() - index * 60_000);
      const iso = eventAt.toISOString();
      await db.insertInto("records").values({ record_id: recordId, user_id: userId, source: "test", content: JSON.stringify({ text: `记录 ${index}`, blocks: [] }), version: 1, status: "pending", task_id: null, event_at: iso, created_at: iso, updated_at: iso }).execute();
      await db.insertInto("project_records").values({ user_id: userId, project_id: projectId, record_id: recordId, record_event_at: eventAt, created_at: now, updated_at: now }).execute();
    }

    const authService = {
      verifyAccess: async () => ({ userId, tokenId: "test-token-id" }),
      assertActiveUser: async () => ({ user_id: userId, status: "active" }),
    };
    const oss = { readUrl: () => "https://private.example", putUrl: () => "https://upload.example" } as any;
    const media = MediaService.create(db, oss);
    const records = RecordService.create(db, new RecordPostprocessQueue());
    const app = createApp({ auth: authService as never, records, media, projects: ProjectService.create(db, records) });
    const auth = { Authorization: "Bearer test-access-token" };

    const detail = await app.request(`/api/projects/${projectId}`, { headers: auth });
    assert.equal(detail.status, 200);
    const detailBody = await detail.json() as any;
    assert.equal(detailBody.result.projectId, projectId);
    assert.equal(detailBody.result.records, undefined);

    const page1 = await app.request(`/api/projects/${projectId}/records?limit=5`, { headers: auth });
    assert.equal(page1.status, 200);
    const page1Body = await page1.json() as any;
    assert.deepEqual(page1Body.result.data.map((item: any) => item.id), recordIds.slice(0, 5));
    assert.equal(page1Body.result.hasMore, true);
    assert.ok(page1Body.result.nextCursor);

    const page2 = await app.request(`/api/projects/${projectId}/records?limit=5&cursor=${encodeURIComponent(page1Body.result.nextCursor)}`, { headers: auth });
    const page2Body = await page2.json() as any;
    assert.deepEqual(page2Body.result.data.map((item: any) => item.id), recordIds.slice(5));
    assert.equal(page2Body.result.hasMore, false);

    const proposed = await app.request("/api/projects?status=proposed", { headers: auth });
    assert.equal((await proposed.json() as any).result.data.length, 2);

    const confirmed = await app.request(`/api/projects/${proposedId}/confirm`, { method: "POST", headers: auth });
    assert.equal((await confirmed.json() as any).result.status, "active");
    const rejected = await app.request(`/api/projects/${rejectedId}/reject`, { method: "POST", headers: auth });
    assert.equal((await rejected.json() as any).result.status, "rejected");
  } finally {
    await db.deleteFrom("project_records").where("user_id", "=", userId).execute().catch(() => undefined);
    await db.deleteFrom("projects").where("user_id", "=", userId).execute().catch(() => undefined);
    await db.deleteFrom("records").where("user_id", "=", userId).execute().catch(() => undefined);
    await db.deleteFrom("users").where("user_id", "=", userId).execute().catch(() => undefined);
    await db.destroy();
  }
});
