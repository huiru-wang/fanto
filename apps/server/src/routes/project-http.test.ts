import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nodeTest from "node:test";
import { sql } from "kysely";
import { createApp } from "../bootstrap/app.js";
import { MediaService } from "../domain/media/index.js";
import { ProjectService, ProposalService, type DomainResult, type CreateProposalInput } from "../domain/projects/index.js";
import { RecordService } from "../domain/records/index.js";
import { createDatabase, runMigrations } from "../infrastructure/database/database.js";
import { RecordPostprocessQueue } from "../infrastructure/queue/record-postprocess-queue.js";
const test = process.env.TEST_DATABASE_URL ? nodeTest : nodeTest.skip;
function data<T>(result: DomainResult<T>): T { if (result.kind !== "ok") assert.fail(result.code); return result.data; }
const error = (result: DomainResult<unknown>, code: string) => assert.deepEqual(result, { kind: "error", code });

test("Proposal / Project Domain and HTTP contract, isolation, transactions and concurrency", async t => {
  const db = createDatabase(process.env.TEST_DATABASE_URL!);
  await runMigrations(db);
  const users = [randomUUID(), randomUUID()], [userId, otherUser] = users as [string, string];
  const now = new Date(), recordIds = Array.from({ length: 9 }, randomUUID), mediaId = randomUUID();
  const media = MediaService.create(db, { readUrl: () => "https://private.example/image", putUrl: () => "https://upload.example" } as never);
  const records = RecordService.create(db, new RecordPostprocessQueue()), projects = ProjectService.create(db, records, media, { embed: async () => [1, ...Array(767).fill(0)] }), proposals = ProposalService.create(db, records, media, { embed: async () => [1, ...Array(767).fill(0)] });
  const auth = { verifyAccess: async (token: string) => ({ userId: token === "other" ? otherUser : userId }), assertActiveUser: async () => ({ status: "active" }) };
  const app = createApp({ auth: auth as never, records, media, projects, proposals });
  const request = async (path: string, method = "GET", body?: unknown, token = "owner") => {
    const r = await app.request(`/api/${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() as any : null };
  };
  const input = (ids = recordIds.slice(0, 7)): CreateProposalInput => ({ type: "create", title: "大观园写记", proposedSummary: "园林里的红楼梦主题照片与旅行回忆", recordIds: ids, content: { reason: "园林与人物照片适合主题创作", idea: "把园林里的这一刻整理成一页有作品感的图文写真。保留真实人物与场景，只增强主题表达。", plan: ["留住这一刻｜保留人物和园林关系", "建立作品气质｜统一画面与主题", "完成一页写真｜用短文收束真实经历"], tags: ["园林入画", "古典写真", "游园一页"] } });
  let projectId: string, proposalId: string;
  try {
    await db.insertInto("users").values(users.map(id => ({ user_id: id, status: "active" as const, created_at: now, updated_at: now, disabled_at: null }))).execute();
    await db.insertInto("media_assets").values({ media_id: mediaId, user_id: userId, object_key: `test/${mediaId}`, media_type: "image", mime_type: "image/png", bytes: 10, status: "ready", ext_data: "{}", created_at: now.toISOString(), updated_at: now.toISOString() }).execute();
    await db.insertInto("records").values(recordIds.map((id, i) => ({ record_id: id, user_id: userId, source: "test", content: JSON.stringify({ text: `记录${i}`, blocks: i === 0 ? [{ type: "image", mediaId, description: "人物在园林中" }] : [] }), version: 1, status: "processed", task_id: null, event_at: new Date(now.getTime() - i * 1000).toISOString(), created_at: now.toISOString(), updated_at: now.toISOString() }))).execute();
    await t.test("strict creation and concurrent idempotent acceptance", async () => {
      error(await proposals.create(userId, { ...input(), recordIds: [recordIds[0]!, randomUUID()] }), "REFERENCE_RECORDS_UNAVAILABLE");
      assert.equal((await db.selectFrom("proposals").selectAll().where("user_id", "=", userId).execute()).length, 0);
      error(await proposals.create(userId, { ...input(), type: "extend" }), "INVALID_INPUT");
      error(await proposals.create(userId, { ...input(), content: { ...input().content, tags: ["重复", "重复"] } }), "INVALID_INPUT");
      error(await proposals.create(userId, { ...input(), content: { ...input().content, plan: input().content.plan.slice(0, 2) } }), "INVALID_INPUT");
      const p = data(await proposals.create(userId, { ...input(), recordIds: [...input().recordIds, recordIds[0]!] })); proposalId = p.proposalId; assert.equal(p.sessionId, null);
      assert.equal(p.content.creation, undefined);
      const [first, second] = await Promise.all([proposals.accept(userId, p.proposalId), proposals.accept(userId, p.proposalId)]);
      const a = data(first), b = data(second); projectId = a.resultProjectId;
      assert.equal(a.resultProjectId, b.resultProjectId); assert.equal(a.addedRecordCount + b.addedRecordCount, 7);
      error(await proposals.reject(userId, p.proposalId), "INVALID_STATE");
      const project = await projects.find(userId, projectId); assert.equal(project?.content, ""); assert.equal(project?.summary, p.proposedSummary); assert.equal(project?.sessionId, null);
      assert.equal(data(await proposals.recordsPage(userId, proposalId, { limit: 100 })).data.length, 7);
    });
    await t.test("HTTP nine routes, pagination scope and privacy", async () => {
      const detail = await request(`projects/${projectId}`); assert.equal(detail.status, 200); assert.equal(detail.body.result.recordCount, 7); assert.equal(detail.body.result.referenceRecords.length, 5);
      const list = await request("projects"); assert.equal(list.body.result.data[0].content, undefined); assert.equal(list.body.result.data[0].summary.length > 0, true);
      assert.equal((await request(`projects/${projectId}`, "GET", undefined, "other")).status, 404);
      assert.equal((await request(`proposals/${proposalId}/accept`, "POST", undefined, "other")).status, 404);
      const pd = await request(`proposals/${proposalId}`); assert.equal(pd.body.result.referenceRecordCount, 7); assert.equal(pd.body.result.proposedSummary, input().proposedSummary); assert.equal(Object.hasOwn(pd.body.result, "summary"), false);
      const first = await request(`proposals/${proposalId}/records?limit=5`); assert.deepEqual(first.body.result.data.map((r: any) => r.id), recordIds.slice(0, 5));
      const cursor = encodeURIComponent(first.body.result.nextCursor);
      const second = await request(`proposals/${proposalId}/records?limit=5&cursor=${cursor}`); assert.deepEqual(second.body.result.data.map((r: any) => r.id), recordIds.slice(5, 7));
      assert.equal((await request(`projects?cursor=${cursor}`)).body.errorCode, "INVALID_CURSOR");
      assert.equal((await request(`proposals/${randomUUID()}/records?cursor=${cursor}`)).body.errorCode, "INVALID_CURSOR");
      for (const suffix of ["records", "restore", "confirm", "reject"]) assert.equal((await request(`projects/${projectId}/${suffix}`, suffix === "records" ? "GET" : "POST")).status, 404);
      for (const path of ["projects?status=proposed", "proposals?type=split", "projects?limit=0", "proposals?limit=1.5", "projects/bad-id", "projects?cursor=bad", "proposals?targetProjectId=bad"]) assert.equal((await request(path)).status, 400);
      assert.equal((await app.request("/api/projects")).status, 401);
    });
    await t.test("content/media checks, optimistic writes, no-op and caller transaction rollback", async () => {
      const body = `# 写真\n\n![园林](fanto-media://${mediaId})\n\n\`\`\`html-preview\n<div style="background-image:url('fanto-media://${mediaId}')"><img src="fanto-media://${mediaId}"></div>\n\`\`\``;
      let p = data(await projects.update(userId, projectId, 1, { content: body, coverMediaId: mediaId })); assert.equal(p.version, 2);
      assert.deepEqual(data(await projects.listReferencedMediaIds(userId, projectId)), [mediaId]);
      assert.equal(data(await projects.update(userId, projectId, 2, { content: body })).version, 2);
      error(await projects.update(userId, projectId, 1, { title: "lost" }), "VERSION_CONFLICT");
      const [a, b] = await Promise.all([projects.update(userId, projectId, 2, { summary: "A" }), projects.update(userId, projectId, 2, { summary: "B" })]);
      assert.equal([a, b].filter(v => v.kind === "ok").length, 1); assert.equal([a, b].filter(v => v.kind === "error" && v.code === "VERSION_CONFLICT").length, 1);
      p = (await projects.find(userId, projectId))!;
      const before = p;
      await assert.rejects(db.transaction().execute(async trx => { data(await projects.update(userId, projectId, p.version, { title: "rollback" }, { transaction: trx })); assert.equal((await projects.find(userId, projectId, { transaction: trx }))?.title, "rollback"); throw new Error("rollback"); }));
      assert.deepEqual(await projects.find(userId, projectId), before);
      assert.equal((await request(`projects/${projectId}`, "PATCH", { expectedVersion: p.version, sessionId: "illegal" })).status, 400);
      error(await projects.update(userId, projectId, p.version, { content: `![x](fanto-media://${randomUUID()})` }), "MEDIA_NOT_READY");
      error(await projects.update(otherUser, projectId, p.version, { title: "theft" }), "NOT_FOUND");
      const uploading = randomUUID();
      await db.insertInto("media_assets").values({ media_id: uploading, user_id: userId, object_key: `test/${uploading}`, media_type: "image", mime_type: "image/png", bytes: 1, status: "uploading", ext_data: "{}", created_at: now.toISOString(), updated_at: now.toISOString() }).execute();
      error(await projects.update(userId, projectId, p.version, { coverMediaId: uploading }), "MEDIA_NOT_READY");
      assert.equal((await request(`projects/${projectId}`, "PATCH", { expectedVersion: p.version, content: "中".repeat(700000) })).status, 413);
      const cleared = data(await projects.update(userId, projectId, p.version, { content: "", coverMediaId: null })); assert.equal(cleared.content, ""); assert.equal(cleared.coverMediaId, null);
    });
    await t.test("extend, deletions, missing references, reject and archive", async () => {
      const original = (await projects.find(userId, projectId))!;
      const extend = { ...input([recordIds[0]!, recordIds[7]!]), type: "extend" as const, proposedSummary: null, targetProjectId: projectId };
      const p = data(await proposals.create(userId, extend)); assert.equal(data(await proposals.accept(userId, p.proposalId)).addedRecordCount, 1);
      let current = (await projects.find(userId, projectId))!; assert.equal(current.version, original.version + 1); assert.equal(current.summary, original.summary);
      const duplicate = data(await proposals.create(userId, extend)); assert.equal(data(await proposals.accept(userId, duplicate.proposalId)).addedRecordCount, 0); assert.equal((await projects.find(userId, projectId))?.version, current.version);
      const missing = data(await proposals.create(userId, input([recordIds[8]!])));
      assert.equal((await records.delete(userId, recordIds[8]!, 1)).kind, "ok"); error(await proposals.accept(userId, missing.proposalId), "REFERENCE_RECORDS_UNAVAILABLE"); assert.equal((await proposals.find(userId, missing.proposalId))?.status, "pending");
      const partial = data(await proposals.create(userId, input([recordIds[5]!, recordIds[6]!])));
      assert.equal((await records.delete(userId, recordIds[6]!, 1)).kind, "ok"); assert.equal(data(await proposals.accept(userId, partial.proposalId)).addedRecordCount, 1);
      current = (await projects.find(userId, projectId))!; assert.equal(current.version, original.version + 2);
      const links = await db.selectFrom("record_links").selectAll().where("user_id", "=", userId).where("record_id", "=", recordIds[6]!).execute(); assert.equal(links.length, 0);
      const rejected = data(await proposals.create(userId, input([recordIds[4]!])));
      const r1 = data(await proposals.reject(userId, rejected.proposalId)), r2 = data(await proposals.reject(userId, rejected.proposalId)); assert.deepEqual(r1, r2); error(await proposals.accept(userId, rejected.proposalId), "INVALID_STATE");
      const pending = data(await proposals.create(userId, { ...extend, recordIds: [recordIds[4]!] }));
      const archive = await request(`projects/${projectId}/archive`, "POST", { expectedVersion: current.version }); assert.equal(archive.status, 200);
      assert.equal(data(await projects.archive(userId, projectId, 1)).version, archive.body.result.version);
      error(await proposals.accept(userId, pending.proposalId), "INVALID_STATE"); error(await projects.update(userId, projectId, archive.body.result.version, { title: "archived" }), "INVALID_STATE");
      assert.equal((await records.delete(userId, recordIds[4]!, 1)).kind, "ok"); assert.equal((await projects.find(userId, projectId))?.version, archive.body.result.version + 1);
      assert.equal(data(await projects.search(userId, { query: "项目主题" })).data.some(p => p.projectId === projectId), false);
    });
    await t.test("creative goal contract, internal recovery pagination and source boundaries", async () => {
      const creation = { objective: "做一篇古典园林写真", context: "园林游览照片", constraints: ["保留人物"], successCriteria: ["主题一致"] };
      const p = data(await proposals.create(userId, { ...input([recordIds[0]!]), content: { ...input().content, creation } })); assert.deepEqual(p.content.creation, creation);
      const accepted = data(await proposals.accept(userId, p.proposalId, { userInput: "不要文字，整体更温暖一点" }));
      assert.deepEqual(accepted.proposal.content.creation?.constraints, [...creation.constraints, "用户补充创作想法：不要文字，整体更温暖一点"]);
      const extension = data(await proposals.create(userId, { ...input([recordIds[0]!]), type: "extend", targetProjectId: accepted.resultProjectId, proposedSummary: null, content: { ...input().content, creation } })); assert.deepEqual(extension.content.creation, creation);
      data(await proposals.accept(userId, extension.proposalId));
      error(await proposals.create(userId, { ...input([recordIds[0]!]), content: { ...input().content, creation: { ...creation, imageCount: 4 } } } as never), "INVALID_INPUT");
      error(await proposals.create(userId, { ...input([recordIds[0]!]), content: { ...input().content, creation: { ...creation, objective: "" } } }), "INVALID_INPUT");
      const first = data(await proposals.scanAcceptedCreations({ limit: 1 })); assert.equal(first.data.length, 1); assert.equal(first.hasMore, true); assert.deepEqual(first.data[0]?.referenceRecordIds, [recordIds[0]]);
      const second = data(await proposals.scanAcceptedCreations({ limit: 100, cursor: first.nextCursor! })); assert.ok(second.data.some(v => v.proposalId === extension.proposalId)); assert.ok(second.data.every(v => !!v.creation.objective && v.resultProjectId && v.userId));
    });
    await t.test("concurrent deletion and acceptance never leave dangling links", async () => {
      for (let i = 0; i < 5; i++) {
        const id = randomUUID(), iso = now.toISOString();
        await db.insertInto("records").values({ record_id: id, user_id: userId, source: "test", content: '{"text":"race","blocks":[]}', version: 1, status: "processed", task_id: null, event_at: iso, created_at: iso, updated_at: iso }).execute();
        const p = data(await proposals.create(userId, input([id])));
        const [accepted, deleted] = await Promise.all([proposals.accept(userId, p.proposalId), records.delete(userId, id, 1)]); assert.equal(deleted.kind, "ok");
        if (accepted.kind === "error") assert.equal(accepted.code, "REFERENCE_RECORDS_UNAVAILABLE");
        assert.equal((await db.selectFrom("record_links").selectAll().where("user_id", "=", userId).where("record_id", "=", id).execute()).length, 0);
      }
    });
    await t.test("failed accept rolls back Project and decision, and cross-user references are rejected", async () => {
      const p = data(await proposals.create(userId, input([recordIds[1]!])));
      const before = await db.selectFrom("projects").select("project_id").where("user_id", "=", userId).execute();
      const suffix = randomUUID().replaceAll("-", "");
      const fn = `test_fail_link_${suffix}`, trigger = `test_link_${suffix}`;
      // Test-only database failure injection: identifiers and predicate are generated UUIDs.
      await sql.raw(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'project' AND NEW.user_id = '${userId}' THEN RAISE EXCEPTION 'injected link failure'; END IF; RETURN NEW; END $$`).execute(db);
      await sql.raw(`CREATE TRIGGER ${trigger} BEFORE INSERT ON record_links FOR EACH ROW EXECUTE FUNCTION ${fn}()`).execute(db);
      try { await assert.rejects(proposals.accept(userId, p.proposalId), /injected link failure/); }
      finally { await sql.raw(`DROP TRIGGER ${trigger} ON record_links; DROP FUNCTION ${fn}()`).execute(db); }
      assert.equal((await proposals.find(userId, p.proposalId))?.status, "pending");
      assert.deepEqual(await db.selectFrom("projects").select("project_id").where("user_id", "=", userId).execute(), before);
      error(await proposals.create(otherUser, input([recordIds[1]!])), "REFERENCE_RECORDS_UNAVAILABLE");
      const ownProject = data(await proposals.accept(userId, p.proposalId)).resultProjectId;
      const image = randomUUID(), record = randomUUID(), iso = now.toISOString();
      await db.insertInto("media_assets").values({ media_id: image, user_id: otherUser, object_key: `test/${image}`, media_type: "image", mime_type: "image/png", bytes: 1, status: "ready", ext_data: "{}", created_at: iso, updated_at: iso }).execute();
      await db.insertInto("records").values({ record_id: record, user_id: otherUser, source: "test", content: '{"text":"other","blocks":[]}', version: 1, status: "processed", task_id: null, event_at: iso, created_at: iso, updated_at: iso }).execute();
      error(await projects.update(userId, ownProject, 1, { content: `![x](fanto-media://${image})` }), "MEDIA_NOT_READY");
      error(await proposals.create(userId, input([record])), "REFERENCE_RECORDS_UNAVAILABLE");
      error(await proposals.create(otherUser, { ...input([record]), type: "extend", targetProjectId: ownProject, proposedSummary: null }), "NOT_FOUND");
      assert.equal(data(await proposals.list(otherUser, { limit: 100 })).data.length, 0);
      const a = data(await proposals.create(userId, input([recordIds[1]!])));
      const b = data(await proposals.create(userId, input([recordIds[1]!])));
      const page = data(await proposals.list(userId, { status: "pending", type: "create", limit: 1 }));
      assert.equal(page.hasMore, true);
      error(await proposals.list(userId, { status: "accepted", type: "create", limit: 1, cursor: page.nextCursor! }), "INVALID_CURSOR");
      error(await proposals.list(otherUser, { status: "pending", type: "create", limit: 1, cursor: page.nextCursor! }), "INVALID_CURSOR");
      const next = data(await proposals.list(userId, { status: "pending", type: "create", limit: 100, cursor: page.nextCursor! }));
      assert.ok(next.data.some(v => v.proposalId === a.proposalId || v.proposalId === b.proposalId));
    });
    await t.test("database rejects invalid state combinations", async () => {
      await assert.rejects(sql`UPDATE proposals SET type = 'split' WHERE proposal_id = ${proposalId}`.execute(db));
      await assert.rejects(sql`UPDATE proposals SET resolved_at = NULL WHERE proposal_id = ${proposalId}`.execute(db));
      await assert.rejects(sql`UPDATE projects SET status = 'proposed' WHERE project_id = ${projectId}`.execute(db));
    });
  } finally {
    await db.deleteFrom("users").where("user_id", "in", users).execute();
    await db.destroy();
  }
});
