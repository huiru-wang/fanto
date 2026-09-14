import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import test from "node:test";
import { createApp } from "../bootstrap/app.js";
import { CreationProposalRepository } from "../domain/creations/proposal-repository.js";
import { CreationReadRepository } from "../domain/creations/creation-repository.js";
import { SqliteMediaRepository } from "../domain/media/sqlite-repository.js";
import { SqliteRecordRepository } from "../domain/records/sqlite-repository.js";
import { createDatabase, runMigrations } from "../infrastructure/database/database.js";
import { LocalMediaQueue } from "../infrastructure/queue/media-queue.js";
import { nowIso } from "../infrastructure/time.js";

test("creation and proposal HTTP routes preserve the public read and decision contract", async () => {
  const path = `/tmp/fanto-creation-http-${randomUUID()}.sqlite`;
  const db = createDatabase(path);
  await runMigrations(db);
  const userId = "creation-http-user";
  const creationId = randomUUID();
  const proposalId = randomUUID();
  const rejectedProposalId = randomUUID();
  const recordId = randomUUID();
  const now = nowIso();
  try {
    await db.insertInto("users").values({ user_id: userId, wx_openid: userId, created_at: now }).execute();
    await db.insertInto("creation_kinds").values({ kind_id: "kind-thread", owner_user_id: null, name: "thread", title: "持续线索", created_at: now, updated_at: now }).execute();
    await db.insertInto("records").values({ record_id: recordId, user_id: userId, source: "test", content: JSON.stringify({ text: "一条关联记录", blocks: [] }), version: 1, status: "pending", task_id: null, created_at: now, updated_at: now }).execute();
    await db.insertInto("creations").values({ creation_id: creationId, user_id: userId, title: "正在验证的脉络", kind_id: "kind-thread", session_id: "test", summary: "可被前端直接展示的摘要", content: "## 正文\n\n保留 Markdown 内容。", status: "active", version: 1, created_at: now, updated_at: now }).execute();
    await db.insertInto("entity_relations").values({ relation_id: randomUUID(), user_id: userId, source_entity_id: recordId, source_entity_type: "record", target_entity_id: creationId, target_entity_type: "creation", relation_type: "record_creation", source_created_at: now, created_at: now }).execute();
    for (const [id, title] of [[proposalId, "待确认的新脉络"], [rejectedProposalId, "待暂不保留的脉络"]] as const) {
      await db.insertInto("creation_proposals").values({ proposal_id: id, user_id: userId, creation_id: null, base_creation_version: null, operation: "create", session_id: "test", title, kind_id: "kind-thread", summary: "待确认观察", content: "## 提案正文\n\n保持与标题不同的内容。", ext_data: "{}", status: "pending_confirmation", error: null, created_at: now, updated_at: now }).execute();
    }
    await db.insertInto("entity_relations").values({ relation_id: randomUUID(), user_id: userId, source_entity_id: recordId, source_entity_type: "record", target_entity_id: proposalId, target_entity_type: "creation_proposal", relation_type: "record_creation_proposal", source_created_at: now, created_at: now }).execute();

    const app = createApp(new SqliteRecordRepository(db), new SqliteMediaRepository(db), new LocalMediaQueue(), { readUrl: () => "https://private.example", putUrl: () => "https://upload.example" } as any, { apiKey: "", asrBaseUrl: "", vlBaseUrl: "" }, undefined, new CreationReadRepository(db), new CreationProposalRepository(db));
    const auth = { "x-user-id": userId };
    assert.equal((await app.request("/health")).status, 200);
    assert.equal((await app.request("/api/creation-kinds", { headers: auth })).status, 200);
    const overview = await app.request("/api/creations/overview", { headers: auth });
    assert.equal(overview.status, 200);
    assert.equal((await overview.json() as any).result.tracking[0].creation_id, creationId);
    const list = await app.request("/api/creations?kindId=kind-thread", { headers: auth });
    assert.equal((await list.json() as any).result.data[0].creation_id, creationId);
    assert.equal((await app.request(`/api/creations/${creationId}`, { headers: auth })).status, 200);
    const sourcePage = await app.request(`/api/creations/${creationId}/records?limit=1`, { headers: auth });
    assert.equal((await sourcePage.json() as any).result.data[0].record_id, recordId);
    const proposals = await app.request("/api/creation-proposals?status=pending_confirmation", { headers: auth });
    assert.equal((await proposals.json() as any).result.data.find((item: any) => item.proposalId === proposalId).sourceCount, 1);
    const proposal = await app.request(`/api/creation-proposals/${proposalId}`, { headers: auth });
    assert.equal((await proposal.json() as any).result.sources[0].record_id, recordId);
    const confirmed = await app.request(`/api/creation-proposals/${proposalId}/confirm`, { method: "POST", headers: auth });
    assert.equal((await confirmed.json() as any).result.proposalStatus, "confirmed");
    const rejected = await app.request(`/api/creation-proposals/${rejectedProposalId}/reject`, { method: "POST", headers: auth });
    assert.equal((await rejected.json() as any).result.proposalStatus, "rejected");
  } finally {
    await db.destroy();
    await rm(path, { force: true });
    await rm(`${path}-wal`, { force: true });
    await rm(`${path}-shm`, { force: true });
  }
});
