import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "../../infrastructure/database/database.js";
import { RecordPostprocessQueue } from "../../infrastructure/queue/record-postprocess-queue.js";
import { RecordService } from "../records/index.js";
import { MediaService } from "../media/index.js";
import { ProjectService, ProposalService, type DomainResult } from "./index.js";
const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const value = <T>(result: DomainResult<T>): T => { if (result.kind === "error") assert.fail(result.code); return result.data; };

integration("Project summary vectors: ranking, isolation, updates, failure atomicity and old projects", async () => {
  const admin = createDatabase(process.env.TEST_DATABASE_URL!), name = `project_search_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = createDatabase(url.href);
  let unavailable = false, calls = 0;
  const embeddings = { embed: async (text: string) => { calls++; if (unavailable) throw new Error("unavailable"); return [text.includes("红楼梦") ? 1 : 0, text.includes("红楼梦") ? 0 : 1, ...Array(766).fill(0)]; } };
  try {
    await runMigrations(db);
    const now = new Date(), owner = randomUUID(), other = randomUUID();
    await db.insertInto("users").values([owner, other].map(user_id => ({ user_id, status: "active" as const, created_at: now, updated_at: now, disabled_at: null }))).execute();
    const records = RecordService.create(db, new RecordPostprocessQueue()), media = MediaService.create(db, {} as never);
    const projects = ProjectService.create(db, records, media, embeddings), proposals = ProposalService.create(db, records, media, embeddings);
    const r = await records.create(owner, { text: "大观园游览", media: [], eventAt: now.toISOString() }); assert.equal(r.kind, "ok"); if (r.kind !== "ok") return;
    const make = async (summary: string) => value(await proposals.create(owner, { type: "create", title: summary, proposedSummary: summary, recordIds: [r.record.id], content: { reason: "主题创作", idea: "把这次真实经历整理成一个可继续的作品。", plan: ["保留经历｜使用真实记录", "整理主题｜突出核心线索", "形成作品｜沉淀为可继续成果"], tags: ["经历成章", "这一页"], goal: {objective: "整理真实经历"} } }));
    const p = await make("大观园红楼梦角色扮演写真图文");
    const accepted = value(await proposals.accept(owner, p.proposalId)), id = accepted.resultProjectId;
    const before = await db.selectFrom("projects").selectAll().where("project_id", "=", id).executeTakeFirstOrThrow();
    assert.ok(before.embedding); assert.equal(before.summary, p.proposedSummary);
    const count = calls; value(await proposals.accept(owner, p.proposalId)); assert.equal(calls, count);
    // More than a page of recent unrelated projects must not hide an older relevant project.
    await db.insertInto("projects").values(Array.from({ length: 45 }, (_, i) => ({ project_id: randomUUID(), user_id: owner, session_id: null, title: "旅行风景", summary: "富士山旅行风景照片", embedding: `[0,1,${Array(766).fill(0).join(",")}]`, cover_media_id: null, content: "", goal: {objective:"旅行风景"}, status: "active" as const, version: 1, created_at: now, updated_at: new Date(now.getTime() + i + 1) }))).execute();
    await db.insertInto("projects").values({ ...before, project_id: randomUUID(), user_id: other }).execute();
    const hits = value(await projects.search(owner, { query: "红楼梦古典园林写真" })).data;
    assert.equal(hits.length, 3); assert.equal(hits[0]!.projectId, id); assert.equal(hits[0]!.similarity, 1);
    assert.doesNotMatch(JSON.stringify(value(await projects.detail(owner, id))), /embedding/);
    assert.equal((await projects.find(other, id)), null);
    unavailable = true;
    assert.deepEqual(await projects.update(owner, id, 1, { summary: "富士山旅行" }), { kind: "error", code: "EMBEDDING_UNAVAILABLE" });
    const failed = await db.selectFrom("projects").selectAll().where("project_id", "=", id).executeTakeFirstOrThrow();
    assert.equal(failed.version, 1); assert.equal(failed.summary, before.summary); assert.equal(failed.embedding, before.embedding);
    const pending = await make("红楼梦写真");
    assert.deepEqual(await proposals.accept(owner, pending.proposalId), { kind: "error", code: "EMBEDDING_UNAVAILABLE" });
    assert.equal((await proposals.find(owner, pending.proposalId))!.status, "pending");
    assert.deepEqual(await projects.search(owner, { query: "红楼梦" }), { kind: "error", code: "EMBEDDING_UNAVAILABLE" });
    unavailable = false;
    value(await projects.update(owner, id, 1, { summary: "富士山旅行风景图文" }));
    const changed = await db.selectFrom("projects").selectAll().where("project_id", "=", id).executeTakeFirstOrThrow();
    assert.notEqual(changed.embedding, before.embedding); assert.equal(changed.version, 2);
    await db.updateTable("projects").set({ embedding: null }).where("project_id", "=", id).execute();
    value(await projects.search(owner, { query: "富士山" }));
    const recovered = await db.selectFrom("projects").selectAll().where("project_id", "=", id).executeTakeFirstOrThrow();
    assert.ok(recovered.embedding); assert.equal(recovered.version, 2);
    value(await projects.archive(owner, id, 2));
    assert.ok(value(await projects.search(owner, { query: "富士山" })).data.every(p => p.projectId !== id));
  } finally {
    await db.destroy(); await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin); await admin.destroy();
  }
});
