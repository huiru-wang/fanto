import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "./database.js";
const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration("old Proposal execution brief migrates to goal without losing a paid run's budget", async () => {
  const admin = createDatabase(process.env.TEST_DATABASE_URL!), name = `goal_migration_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = createDatabase(url.href);
  try {
    await runMigrations(db);
    const userId = randomUUID(), projectId = randomUUID(), proposalId = randomUUID(), runId = randomUUID(), mediaId = randomUUID(), now = new Date();
    await db.insertInto("users").values({ user_id: userId, status: "active", created_at: now, updated_at: now, disabled_at: null }).execute();
    await db.insertInto("projects").values({ project_id: projectId, user_id: userId, session_id: null, title: "游园", summary: "大观园红楼梦主题", embedding: null, content: "", cover_media_id: null, status: "active", version: 1, created_at: now, updated_at: now }).execute();
    const old = { objective: "创作园林写真与配文", intent: "roleplay_article", theme: "红楼梦", sourceMediaIds: [mediaId], subject: { mediaId, description: "假山旁的人物" }, preserve: ["人物身份"], changes: ["服饰"], imageCount: 2, composition: "create" };
    await db.insertInto("proposals").values({ proposal_id: proposalId, user_id: userId, session_id: null, type: "create", target_project_id: null, title: "游园", proposed_summary: "大观园红楼梦主题", content: { reason: "园林人物", idea: "古典游园", plan: [], creation: old }, status: "accepted", result_project_id: projectId, created_at: now, updated_at: now, resolved_at: now }).execute();
    await db.insertInto("creation_runs").values({ run_id: runId, user_id: userId, proposal_id: proposalId, project_id: projectId, status: "failed", execution_plan: null, base_project_version: 1, agent_session_id: null, lease_token: null, lease_expires_at: null, progress: {}, published_project_version: null, attempts: 1, error_code: "IMAGE_RESULT_UNKNOWN", accepted_at: now, created_at: now, updated_at: now }).execute();
    await db.insertInto("creation_image_steps").values({ run_id: runId, image_index: 1, fingerprint: "paid-original", status: "unknown", media_id: mediaId, metadata: null, recovery_ciphertext: null, recovery_expires_at: null, error_code: "IMAGE_RESULT_UNKNOWN", created_at: now, updated_at: now }).execute();
    await sql`DELETE FROM kysely_migration WHERE name = 'zzzzzzzzz_proposal_creation_goal'`.execute(db);
    await runMigrations(db);
    await runMigrations(db);
    const proposal = await db.selectFrom("proposals").selectAll().where("proposal_id", "=", proposalId).executeTakeFirstOrThrow();
    const content = proposal.content as { creation: Record<string, unknown> };
    assert.deepEqual(Object.keys(content.creation).sort(), ["constraints", "context", "objective", "successCriteria"]);
    assert.deepEqual(content.creation.constraints, ["保留：人物身份", "允许变化：服饰"]);
    assert.match((content.creation.successCriteria as string[])[0]!, /2 张/);
    const run = await db.selectFrom("creation_runs").selectAll().where("run_id", "=", runId).executeTakeFirstOrThrow();
    assert.deepEqual(run.execution_plan, { sourceMediaIds: [mediaId], subject: old.subject, imageCount: 2, composition: "create" });
    assert.equal(run.status, "failed"); assert.equal(run.error_code, "IMAGE_RESULT_UNKNOWN");
    const step = await db.selectFrom("creation_image_steps").selectAll().where("run_id", "=", runId).executeTakeFirstOrThrow();
    assert.equal(step.status, "unknown"); assert.equal(step.fingerprint, "paid-original");
  } finally {
    await db.destroy(); await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin); await admin.destroy();
  }
});
