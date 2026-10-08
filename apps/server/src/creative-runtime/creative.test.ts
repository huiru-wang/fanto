import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { sql } from "kysely";
import sharp from "sharp";
import { createDatabase, runMigrations } from "../infrastructure/database/database.js";
import { RecordService } from "../domain/records/index.js";
import { ProjectService, ProposalService, type CreateProposalInput } from "../domain/projects/index.js";
import { MediaService } from "../domain/media/index.js";
import { RecordPostprocessQueue } from "../infrastructure/queue/record-postprocess-queue.js";
import { registerRecordPostprocessListener } from "../listeners/record-postprocess.listener.js";
import { CreativeService } from "./service.js";
import { CreativeRunner } from "./runner.js";
import { ImageClientError } from "../infrastructure/clients/creative-image-client.js";
import { createAgentRuntime } from "../agent/agent-runtime.js";
import { createApp } from "../bootstrap/app.js";
import type { CreativeContext } from "./model.js";
import type { runAgent } from "../agent/harness/run.js";
const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const waitFor = async (check: () => Promise<boolean>) => { for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail("Timed out waiting for pipeline"); };
integration("Record → analysis → Proposal → acceptance → image → Markdown, recovery and isolation", async t => {
  const admin = createDatabase(process.env.TEST_DATABASE_URL!), name = `creative_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = createDatabase(url.href), dir = mkdtempSync(resolve(tmpdir(), "fanto-creative-"));
  const userId = randomUUID(), otherId = randomUUID(), objects = new Map<string, Buffer>();
  const png = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#98a9b8" } }).png().toBuffer();
  const oss = { putObject: async (key: string, data: Buffer) => { objects.set(key, data); }, getObject: async (key: string) => objects.get(key)!, readUrl: (key: string) => `https://test.example/${key}?signature=private`, remove: async (key: string) => { objects.delete(key); } };
  let paidCalls = 0, downloads = 0, visionCalls = 0, mode = "ok", downloadFailure = false;
  const image = { generate: async () => { paidCalls++; if (mode === "unknown") throw new ImageClientError("IMAGE_RESULT_UNKNOWN"); return { recovery: "encrypted-test-only" }; }, download: async () => { downloads++; if (downloadFailure) { downloadFailure = false; throw new ImageClientError("IMAGE_SAVE_RETRYABLE"); } return { data: png, mimeType: "image/png" as const, width: 512, height: 512 }; } };
  const queue = new RecordPostprocessQueue(), records = RecordService.create(db, queue, undefined, undefined, CreativeService.enqueueRecord), media = MediaService.create(db, oss as never);
  const projects = ProjectService.create(db, records, media, { embed: async () => [1, ...Array(767).fill(0)] }), proposals = ProposalService.create(db, records, media, { embed: async () => [1, ...Array(767).fill(0)] });
  const creative = new CreativeService(db, records, projects, proposals, media, image, async id => { assert.equal(id, userId); });
  const agent = createAgentRuntime({ records, media, projects, proposals, creative, tasks: {} as never, memories: {} as never, sessionDatabasePath: resolve(dir, "sessions.sqlite"), workspaceRoot: resolve(dir, "workspaces"), definitionPath: resolve("agent.yaml"), deepseekApiKey: "test-only" } as Parameters<typeof createAgentRuntime>[0]);
  const app = createApp({ records, media, projects, proposals, creative, agent, auth: { verifyAccess: async (token: string) => ({ userId: token === "other" ? otherId : userId }), assertActiveUser: async () => {} } as never });
  const request = async (path: string, method = "GET", body?: unknown, token = "owner") => {
    const response = await app.request(`/api/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  let targetProjectId: string | undefined, assessmentMode = "proposal", lastContext: CreativeContext | undefined;
  const input = (recordId: string, mediaId: string): CreateProposalInput => ({ type: targetProjectId ? "extend" : "create", ...(targetProjectId ? { targetProjectId, proposedSummary: null } : { proposedSummary: "大观园游览中的红楼梦主题写真" }), title: "园林里的红楼梦", recordIds: [recordId], content: { reason: "地点与人物照片适合主题创作", idea: "把园林里的真实人物做成一页红楼主题写真。保留本人身份与年龄感，只转化服饰和古典氛围。", plan: ["保留本人｜脸部、年龄感和姿态不变", "进入红楼世界｜统一服饰与园林氛围", "完成主题写真｜形成一页可阅读作品"], tags: ["红楼入画", "古典写真", "大观园"], creation: { objective: "创作一张红楼梦主题照片并配文", context: "原记录为园林里的成年人物", constraints: ["保留：人物身份与年龄", "转化：红楼梦服饰与古典氛围"], successCriteria: ["一张主题图片与真实配文"] } } });
  const run: typeof runAgent = async (session, _message, signal, metadata) => {
    const context: CreativeContext = { userId: session.userId, sessionId: session.id, creative: metadata.creative, signal }; lastContext = context;
    const scope: any = await creative.context(context);
    if (metadata.creative?.role === "proposal") {
      const rs = await creative.readRecords(context, { recordIds: scope.recordIds });
      await creative.readProject(context, { action: "search", query: "园林红楼梦主题人物写真" });
      if (assessmentMode === "none") return JSON.stringify({ decision: "no_proposal", reason: "记录没有明确二次创作主题" });
      if (assessmentMode === "ambiguous") return JSON.stringify({ decision: "no_proposal", reason: "人物主体不明确，无法静默确定创作范围" });
      const block = rs[0]!.content.blocks.find(b => b.type === "image")!;
      assert.equal(block.type, "image");
      await creative.createProposal(context, input(rs[0]!.id, block.mediaId));
      return "";
    }
    if (scope.proposalId === proposalId) {
      assert.ok(scope.creation.constraints?.includes("用户补充创作想法：不要文字，整体更温暖一点"));
    }
    const refs = await creative.readRecords(context, { recordIds: scope.referenceRecordIds });
    const project: any = await creative.readProject(context, { action: "get", projectId: scope.projectId });
    const source = scope.executionPlan?.sourceMediaIds ?? refs.flatMap((r: any) => r.content.blocks.filter((b: any) => b.type === "image").map((b: any) => b.mediaId));
    const executionPlan = scope.executionPlan ?? await creative.prepare(context, { sourceMediaIds: [source[0]], subjectMediaId: source[0], imageCount: 1 });
    const saved = scope.generatedImages[0] ?? await creative.generateImage(context, { imageIndex: 1, prompt: "在原照片上编辑服饰为古典服饰，保留人物身份年龄和园林", referenceMediaIds: executionPlan.sourceMediaIds });
    await creative.publish(context, { expectedVersion: project.version, summary: "大观园园林中的成年人物红楼梦主题角色扮演写真图文，保留人物身份，以服饰和氛围变化延续主题。", markdown: `## 园林中的新故事\n\n![主题照片](fanto-media://${saved.mediaId})\n\n这是根据园林记录创作的一篇主题图文。` });
    return "";
  };
  const runner = new CreativeRunner(creative, records, agent, { intervalMs: 10, workers: 1, proposalTimeoutMs: 10_000, creatorTimeoutMs: 10_000 }, run, (session, _skill, message, signal, metadata, emit) => run(session, message, signal, metadata, emit));
  let recordId: string, proposalId: string, projectId: string;
  const createRecord = async () => {
    const id = randomUUID(), now = new Date().toISOString(), key = `test/${id}.png`; objects.set(key, png);
    await db.insertInto("media_assets").values({ media_id: id, user_id: userId, object_key: key, media_type: "image", mime_type: "image/png", bytes: png.length, status: "ready", ext_data: "{}", created_at: now, updated_at: now }).execute();
    const response = await request("records", "POST", { text: "今天在大观园拍了一张照片", media: [{ mediaId: id }], eventAt: now, source: "test", location: { name: "大观园", latitude: 39.87, longitude: 116.35 } });
    assert.equal(response.status, 201);
    return response.body.result.id as string;
  };
  const findProposal = async (id: string) => {
    await waitFor(async () => (await creative.analysisStatus(userId, id))?.analysis?.status === "completed");
    const row = await db.selectFrom("proposal_runs").selectAll().where("record_id", "=", id).executeTakeFirstOrThrow();
    assert.ok(row.proposal_id); return row.proposal_id;
  };
  try {
    await runMigrations(db);
    const now = new Date(); await db.insertInto("users").values([userId, otherId].map(id => ({ user_id: id, status: "active" as const, created_at: now, updated_at: now, disabled_at: null }))).execute();
    registerRecordPostprocessListener(queue, records, media, oss as never, { describe: async () => { visionCalls++; return { description: "一个成年人物站在古典园林中，人物清晰" }; } } as never, {} as never, { replaceRecord: async () => {} });
    runner.start();
    await t.test("automatic proposal, public internal-agent prohibition, explicit acceptance and publication", async () => {
      recordId = await createRecord(); proposalId = await findProposal(recordId);
      assert.equal(visionCalls, 1); assert.equal(paidCalls, 0);
      const analysis = await db.selectFrom("proposal_runs").selectAll().where("record_id", "=", recordId).executeTakeFirstOrThrow();
      const proposal = (await proposals.find(userId, proposalId))!;
      assert.ok(proposal.sessionId); assert.equal(proposal.sessionId, analysis.agent_session_id);
      assert.equal((await request(`proposals/${proposalId}`)).body.result.sessionId, proposal.sessionId);
      assert.equal((await request(`agent/sessions/${proposal.sessionId}/history`)).status, 403);
      assert.equal((await request("agent/sessions", "POST", { agentId: "creator-agent" })).status, 403);
      const accepted = await request(`proposals/${proposalId}/accept`, "POST", { userInput: "不要文字，整体更温暖一点" }); assert.equal(accepted.status, 200); projectId = accepted.body.result.resultProjectId;
      await waitFor(async () => (await creative.latest(userId, projectId))?.creation?.status === "completed");
      assert.equal(paidCalls, 1); assert.equal(downloads, 1); assert.equal(visionCalls, 1);
      const project = (await projects.find(userId, projectId))!; assert.match(project.content, /fanto-media:\/\//); assert.ok(project.coverMediaId); assert.equal(project.version, 2);
      assert.equal((await request(`projects/${projectId}/creation`, "GET", undefined, "other")).status, 404);
      assert.equal((await request(`records/${recordId}/proposal-analysis`, "GET", undefined, "other")).status, 404);
      const state = JSON.stringify((await request(`projects/${projectId}/creation`)).body); assert.doesNotMatch(state, /encrypted|signature|lease_token|agent_session_id/);
      await request(`proposals/${proposalId}/accept`, "POST"); await runner.tick(); assert.equal(paidCalls, 1);
      await assert.rejects(creative.generateImage({ ...lastContext!, userId: otherId }, { imageIndex: 1, prompt: "steal", referenceMediaIds: [project.coverMediaId!] }), /CREATIVE_LEASE_LOST/);
    });
    await t.test("no value or unclear subject ends silently without Proposal or clarification endpoints", async () => {
      for (const mode of ["none", "ambiguous"]) {
        assessmentMode = mode; const id = await createRecord();
        await waitFor(async () => (await creative.analysisStatus(userId, id))?.analysis?.status === "completed");
        const row = await db.selectFrom("proposal_runs").selectAll().where("record_id", "=", id).executeTakeFirstOrThrow();
        assert.equal((row.outcome as { decision: string }).decision, "no_proposal"); assert.equal(row.proposal_id, null);
        assert.equal((await app.request(`/api/records/${id}/proposal-analysis/resume`, { method: "POST", headers: { Authorization: "Bearer owner" } })).status, 404);
      }
      assert.equal((await app.request("/api/proposal-analyses", { headers: { Authorization: "Bearer owner" } })).status, 404);
      assessmentMode = "proposal";
    });
    await t.test("append keeps prior content, save failure resumes without another paid request", async () => {
      targetProjectId = projectId; const before = (await projects.find(userId, projectId))!.content;
      const id = await createRecord(), p = await findProposal(id); downloadFailure = true;
      const priorPaid = paidCalls, priorDownloads = downloads;
      await request(`proposals/${p}/accept`, "POST");
      await waitFor(async () => { const current = (await creative.latest(userId, projectId))?.creation; return current?.status === "completed" && current.proposalId === p; });
      assert.equal(paidCalls, priorPaid + 1); assert.equal(downloads, priorDownloads + 2);
      assert.ok((await projects.find(userId, projectId))!.content.startsWith(before));
    });
    await t.test("unknown generation outcome stops; restart never resends that image slot", async () => {
      mode = "unknown"; targetProjectId = undefined; const id = await createRecord(), p = await findProposal(id), priorPaid = paidCalls;
      const a = await request(`proposals/${p}/accept`, "POST"), target = a.body.result.resultProjectId;
      await waitFor(async () => (await creative.latest(userId, target))?.creation?.status === "failed");
      assert.equal((await creative.latest(userId, target))?.creation?.errorCode, "IMAGE_RESULT_UNKNOWN"); assert.equal(paidCalls, priorPaid + 1);
      await db.updateTable("creation_runs").set({ status: "queued" }).where("proposal_id", "=", p).execute();
      await waitFor(async () => (await creative.latest(userId, target))?.creation?.status === "failed");
      assert.equal(paidCalls, priorPaid + 1); assert.equal((await projects.find(userId, target))!.content, "");
    });
    await t.test("lease fencing and atomic publication rollback preserve saved images", async () => {
      await runner.stop(); mode = "ok"; targetProjectId = undefined;
      const id = await createRecord();
      await waitFor(async () => (await records.find(userId, id))?.status === "processed");
      const analysis = (await creative.repository.claim("proposal"))!; assert.ok(analysis && "record_id" in analysis);
      const sessionId = randomUUID(); await creative.repository.bind("proposal", analysis.run_id, analysis.lease_token!, sessionId);
      const context: CreativeContext = { userId, sessionId, creative: { role: "proposal", analysisRunId: analysis.run_id, leaseToken: analysis.lease_token! } };
      const rs = await creative.readRecords(context, { recordIds: [id] }); const block = rs[0]!.content.blocks.find(b => b.type === "image")!; assert.equal(block.type, "image");
      const p = await creative.createProposal(context, input(id, block.mediaId));
      const accepted = await proposals.accept(userId, p.proposalId); assert.equal(accepted.kind, "ok"); if (accepted.kind !== "ok") return;
      await creative.reconcileAccepted(); const creation = (await creative.repository.claim("creator"))!;
      assert.ok(creation && "project_id" in creation);
      const creatorSession = randomUUID(); await creative.repository.bind("creator", creation.run_id, creation.lease_token!, creatorSession);
      const c: CreativeContext = { userId, sessionId: creatorSession, creative: { role: "creator", creationRunId: creation.run_id, leaseToken: creation.lease_token! } };
      await assert.rejects(creative.readRecords(c, { recordIds: [recordId] }), /CREATIVE_RECORD_SCOPE/);
      await assert.rejects(creative.readProject(c, { action: "search", query: "园林红楼梦主题人物写真" }), /CREATIVE_PROJECT_SCOPE/);
      await assert.rejects(creative.generateImage(c, { imageIndex: 1, prompt: "不能先生图", referenceMediaIds: [block.mediaId] }), /CREATION_PLAN_REQUIRED/);
      const prepared = await creative.prepare(c, { sourceMediaIds: [block.mediaId], subjectMediaId: block.mediaId, imageCount: 1 });
      assert.deepEqual(await creative.prepare(c, { sourceMediaIds: [block.mediaId], subjectMediaId: block.mediaId, imageCount: 1 }), prepared);
      await assert.rejects(creative.prepare(c, { sourceMediaIds: [block.mediaId], subjectMediaId: block.mediaId, imageCount: 2 }), /CREATION_PLAN_CONFLICT/);
      const saved = await creative.generateImage(c, { imageIndex: 1, prompt: "固定图片", referenceMediaIds: [block.mediaId] });
      const paid = paidCalls, downloaded = downloads;
      // Simulate a crash after ready Media registration, before marking the slot saved.
      await db.updateTable("creation_image_steps").set({ status: "response", metadata: null, recovery_ciphertext: "expired", recovery_expires_at: new Date(Date.now() - 1000) }).where("run_id", "=", creation.run_id).execute();
      await db.updateTable("creation_runs").set({ lease_expires_at: new Date(Date.now() - 1000) }).where("run_id", "=", creation.run_id).execute();
      const publish = { expectedVersion: 1, summary: "园林人物的古典角色扮演写真图文", markdown: `# 成果\n\n![图片](fanto-media://${saved.mediaId})` };
      await assert.rejects(creative.publish(c, publish), /CREATIVE_LEASE_LOST/);
      const renewed = (await creative.repository.claim("creator"))!; assert.equal(renewed.run_id, creation.run_id);
      const newSession = randomUUID(); await creative.repository.bind("creator", renewed.run_id, renewed.lease_token!, newSession);
      const next: CreativeContext = { userId, sessionId: newSession, creative: { role: "creator", creationRunId: renewed.run_id, leaseToken: renewed.lease_token! } };
      await creative.recoverImages(next); assert.equal(paidCalls, paid); assert.equal(downloads, downloaded);
      const suffix = randomUUID().replaceAll("-", ""), fn = `fail_publish_${suffix}`, trigger = `publish_${suffix}`;
      await sql.raw(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.run_id = '${renewed.run_id}' AND NEW.status = 'completed' THEN RAISE EXCEPTION 'publication failure'; END IF; RETURN NEW; END $$`).execute(db);
      await sql.raw(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON creation_runs FOR EACH ROW EXECUTE FUNCTION ${fn}()`).execute(db);
      try { await assert.rejects(creative.publish(next, publish), /publication failure/); }
      finally { await sql.raw(`DROP TRIGGER ${trigger} ON creation_runs; DROP FUNCTION ${fn}()`).execute(db); }
      assert.equal((await projects.find(userId, accepted.data.resultProjectId))!.content, "");
      assert.equal((await creative.repository.creation(userId, renewed.run_id))!.status, "running");
      const receipt = await creative.publish(next, publish); assert.equal(receipt.status, "completed");
      assert.deepEqual(await creative.publish(next, publish), receipt); assert.equal(paidCalls, paid);
    });
  } finally {
    await runner.stop(); await agent.close(); await db.destroy();
    await sql.raw(`DROP DATABASE ${name}`).execute(admin); await admin.destroy(); rmSync(dir, { recursive: true, force: true });
  }
});
