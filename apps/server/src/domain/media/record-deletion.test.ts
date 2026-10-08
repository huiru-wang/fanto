import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "../../infrastructure/database/database.js";
import { RecordService } from "../records/index.js";
import { RecordPostprocessQueue } from "../../infrastructure/queue/record-postprocess-queue.js";
import { MediaService } from "./index.js";
import { ProjectService, ProposalService } from "../projects/index.js";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("Record media deletion is atomic, user-scoped, reference-safe and recovers OSS failures", async () => {
  const admin = createDatabase(process.env.TEST_DATABASE_URL!), name = `media_delete_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE "${name}"`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = createDatabase(url.href);
  const userId = randomUUID(), otherId = randomUUID(), now = new Date();
  const objects = new Map<string, Buffer>();
  let fail = false, calls = 0;
  const oss = { remove: async (key: string) => { calls++; if (fail) throw new Error("OSS unavailable"); objects.delete(key); }, getObject: async (key: string) => objects.get(key)!, putObject: async (key: string, bytes: Buffer) => {objects.set(key,bytes);} };
  const media = MediaService.create(db, oss as never);
  const records = RecordService.create(db, new RecordPostprocessQueue());
  const embedding = { embed: async () => Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0) };
  const projects = ProjectService.create(db, records, media, embedding), proposals = ProposalService.create(db, records, media, embedding);
  const make = async (owner = userId) => {
    const id = randomUUID(), key = `users/${owner}/${id}.png`;
    objects.set(key, Buffer.from("owned test object"));
    await db.insertInto("media_assets").values({ media_id: id, user_id: owner, object_key: key, media_type: "image", mime_type: "image/png", bytes: 17, status: "ready", ext_data: "{}", created_at: now.toISOString(), updated_at: now.toISOString() }).execute();
    const saved = await records.create(owner, { text: "园林记录", media: [{ mediaId: id }], eventAt: now.toISOString() });
    assert.equal(saved.kind, "ok");
    return { id, key, record: saved.record };
  };
  try {
    await runMigrations(db);
    await db.insertInto("users").values([userId, otherId].map(user_id => ({ user_id, status: "active" as const, created_at: now, updated_at: now, disabled_at: null }))).execute();
    const first = await make(), foreign = await make(otherId);
    assert.equal((await records.delete(otherId, first.record.id, 1)).kind, "not_found");
    assert.equal((await records.delete(userId, first.record.id, 2)).kind, "conflict");
    assert.ok(await media.readyMetadata(userId, first.id)); assert.equal(calls, 0);
    // Queue registration and the Record/asset removal roll back together.
    await sql`CREATE FUNCTION reject_record_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced delete rollback'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_record_delete BEFORE DELETE ON records FOR EACH ROW EXECUTE FUNCTION reject_record_delete();`.execute(db);
    await assert.rejects(records.delete(userId, first.record.id, 1), /forced delete rollback/);
    assert.ok(await records.find(userId, first.record.id)); assert.ok(await media.readyMetadata(userId, first.id));
    assert.equal((await db.selectFrom("media_object_deletions").selectAll().execute()).length, 0);
    await sql`DROP TRIGGER reject_record_delete ON records; DROP FUNCTION reject_record_delete();`.execute(db);
    assert.equal((await records.delete(userId, first.record.id, 1)).kind, "ok");
    assert.equal(await records.find(userId, first.record.id), null); assert.equal(await media.readyMetadata(userId, first.id), null);
    assert.ok(objects.has(first.key));
    fail = true; await media.cleanupDeletedObjects();
    const jobs = await db.selectFrom("media_object_deletions").selectAll().execute();
    assert.equal(jobs.length, 1); assert.equal(jobs[0]!.attempts, 1); assert.ok(jobs[0]!.next_attempt_at > new Date());
    const before = calls; await media.cleanupDeletedObjects(); assert.equal(calls, before);
    fail = false;
    await db.updateTable("media_object_deletions").set({ next_attempt_at: new Date(0) }).execute();
    // A new service instance represents a process restart; persisted work is recovered.
    await MediaService.create(db, oss as never).cleanupDeletedObjects();
    assert.equal(objects.has(first.key), false); assert.ok(objects.has(foreign.key)); assert.ok(await media.readyMetadata(otherId, foreign.id));
    assert.equal((await db.selectFrom("media_object_deletions").selectAll().execute()).length, 0);
    // Final Project references are rewritten to separate media so the original Record can be deleted.
    const shared = await make();
    const p = await proposals.create(userId, { type: "create", title: "园林", proposedSummary: "园林写真", recordIds: [shared.record.id], content: { reason: "园林", idea: "把这次园林记录整理成一页写真。", plan: ["保留现场｜使用真实记录", "整理画面｜统一作品气质", "完成写真｜形成可继续的成果"], tags: ["园林写真", "游园一页"], goal: { objective: "一页园林写真" } } });
    assert.equal(p.kind, "ok");
    const accepted = await proposals.accept(userId, p.data.proposalId); assert.equal(accepted.kind, "ok");
    const projectId = accepted.data.resultProjectId;
    assert.equal((await projects.update(userId, projectId, 1, { content: `![照片](fanto-media://${shared.id})`, coverMediaId: shared.id })).kind, "ok");
    assert.equal((await projects.archive(userId, projectId, 2)).kind, "ok");
    assert.equal((await records.delete(userId, shared.record.id, 1)).kind, "ok");
    await media.cleanupDeletedObjects();
    assert.equal(objects.has(shared.key), false);
    assert.equal(await media.readyMetadata(userId, shared.id), null);
    const published = await projects.find(userId, projectId);
    assert.ok(published?.coverMediaId && published.coverMediaId !== shared.id);
    assert.ok(published!.content.includes(published!.coverMediaId!));
    const ownedCopy = await db.selectFrom("media_assets").selectAll().where("media_id", "=", published!.coverMediaId!).executeTakeFirstOrThrow();
    assert.ok(ownedCopy.object_key.startsWith(`users/${userId}/project/${projectId}/`));
    assert.equal(objects.has(ownedCopy.object_key), true);
    assert.equal((await projects.detail(userId, projectId)).kind, "ok");
    // Publishing an unrelated project races deletion: either retain its image,
    // or reject the publication after the asset has disappeared.
    const concurrent = await make(), otherProjectId = randomUUID();
    await db.insertInto("projects").values({ project_id: otherProjectId, user_id: userId, session_id: null, title: "另一个项目", summary: "园林", goal: {objective:"另一个项目"}, embedding: null, cover_media_id: null, content: "", status: "active", version: 1, created_at: now, updated_at: now }).execute();
    const results = await Promise.all([records.delete(userId, concurrent.record.id, 1), projects.update(userId, otherProjectId, 1, { content: `![并发](fanto-media://${concurrent.id})` })]);
    assert.equal(results[0].kind, "ok");
    await media.cleanupDeletedObjects();
    if (results[1].kind === "ok") {
      assert.equal(objects.has(concurrent.key), false);
      assert.equal(await media.readyMetadata(userId, concurrent.id), null);
      const resultProject = results[1].data;
      const resolved = /fanto-media:\/\/([0-9a-f-]{36})/.exec(resultProject.content)?.[1];
      assert.ok(resolved && resolved !== concurrent.id);
      assert.ok((await media.readyMetadata(userId, resolved))?.mediaId === resolved);
    } else {
      assert.equal(results[1].code, "MEDIA_NOT_READY"); assert.equal(objects.has(concurrent.key), false);
    }

  } finally {
    await db.destroy(); await sql.raw(`DROP DATABASE "${name}" WITH (FORCE)`).execute(admin); await admin.destroy();
  }
});
