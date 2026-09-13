import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, runMigrations } from "../../infrastructure/database.js";
import { SqliteCreationRepository } from "./creation.repository.js";
import { SqliteRecordRepository } from "../../infrastructure/repositories/sqlite-record.repository.js";
import { SqliteTaskRepository } from "../../modules/task/task.repository.js";

const summary = { schemaVersion: 1, overview: "一条线索", summaryVersion: 1 };
const content = { title: "测试线索", summary, content: "正文", source: { records: ["record-1"], creations: [], web: [] } };

test("creation proposal confirmation creates, updates, and supersedes stale proposals", async () => {
  const db = createDatabase(`/tmp/fanto-creation-${randomUUID()}.sqlite`); await runMigrations(db);
  const repository = new SqliteCreationRepository(db); const userId = "user-a";
  const createId = await repository.startProposal({ userId, operation: "create", sessionId: randomUUID() });
  await repository.completeProposal(userId, createId, content);
  const created = await repository.confirm(userId, createId);
  assert.equal(created.kind, "confirmed");
  if (created.kind !== "confirmed") return;
  assert.equal(created.creation.version, 1);

  const updateId = await repository.startProposal({ userId, operation: "update", creationId: created.creation.id, baseCreationVersion: 1, sessionId: randomUUID() });
  await repository.completeProposal(userId, updateId, { ...content, title: "更新后的线索" });
  const updated = await repository.confirm(userId, updateId);
  assert.equal(updated.kind, "confirmed");
  if (updated.kind !== "confirmed") return;
  assert.equal(updated.creation.version, 2);

  const staleId = await repository.startProposal({ userId, operation: "update", creationId: created.creation.id, baseCreationVersion: 1, sessionId: randomUUID() });
  await repository.completeProposal(userId, staleId, content);
  const stale = await repository.confirm(userId, staleId);
  assert.equal(stale.kind, "conflict");
  if (stale.kind !== "conflict") return;
  assert.equal(stale.actualVersion, 2);
  assert.equal((await repository.findProposal(userId, staleId))?.status, "superseded");
  await db.destroy();
});

test("failed workflow tasks can release claimed records back to pending", async () => {
  const db = createDatabase(`/tmp/fanto-release-${randomUUID()}.sqlite`); await runMigrations(db);
  const records = new SqliteRecordRepository(db); const userId = "user-a";
  await db.insertInto("users").values({ user_id: userId, wx_openid: userId, created_at: new Date().toISOString() }).execute();
  await records.create({ userId, value: { text: "等待处理的记录", media: [] } });
  const [claimed] = await records.claimForTask(userId, "task-1", 10);
  assert.equal(claimed.status, "processing");
  await records.releaseTask(userId, "task-1");
  const restored = await records.findById(claimed.id);
  assert.equal(restored?.status, "pending");
  assert.equal(restored?.taskId, null);
  await db.destroy();
});

test("proactive task stores all agent sessions and proposal failures are terminal", async () => {
  const db = createDatabase(`/tmp/fanto-task-${randomUUID()}.sqlite`); await runMigrations(db);
  const tasks = new SqliteTaskRepository(db); const creations = new SqliteCreationRepository(db); const userId = "user-a";
  const taskId = await tasks.create(userId, "proactive_creation", { schemaVersion: 1, trigger: "manual" });
  assert.equal((await tasks.claim(taskId))?.userId, userId);
  const plannerSessionId = randomUUID(); await tasks.addSession(taskId, { role: "create_planner", agentId: "proposal-create-agent", sessionId: plannerSessionId });
  const proposalSessionId = randomUUID(); const proposalId = await creations.startProposal({ userId, operation: "create", sessionId: proposalSessionId });
  await tasks.addSession(taskId, { role: "thread_proposal", agentId: "thread-agent", sessionId: proposalSessionId, proposalId });
  await creations.failProposal(userId, proposalId, "INVALID_AGENT_OUTPUT", "overview is missing");
  await tasks.fail(taskId, "INVALID_AGENT_OUTPUT", "overview is missing");
  const task = await db.selectFrom("tasks").selectAll().where("task_id", "=", taskId).executeTakeFirstOrThrow();
  assert.equal(task.status, "failed");
  assert.deepEqual(JSON.parse(task.execution_metadata), { schemaVersion: 1, sessions: [{ role: "create_planner", agentId: "proposal-create-agent", sessionId: plannerSessionId }, { role: "thread_proposal", agentId: "thread-agent", sessionId: proposalSessionId, proposalId }] });
  const proposal = await creations.findProposal(userId, proposalId);
  assert.equal(proposal?.status, "failed");
  assert.equal(proposal?.failureCode, "INVALID_AGENT_OUTPUT");
  await db.destroy();
});
