import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { DB } from "../../infrastructure/database/schema.js";
import { runMigrations } from "../../infrastructure/database/database.js";
import { CheckpointRepository } from "./postgres-repository.js";
import { restoreCheckpoint } from "./restore.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;

integration("V2 checkpoint commits Entries and Usage, paginates by Run and restores Pi Session", async () => {
  if (!/test/i.test(new URL(url!).pathname)) throw Error("Dedicated test database required");
  const admin = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }) });
  const name = `checkpoint_test_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const connection = new URL(url!); connection.pathname = `/${name}`;
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: connection.href }) }) });
  const memory = new MemorySessionRepo();
  try {
    await runMigrations(db);
    const repository = new CheckpointRepository(db);
    const sessionId = randomUUID(), runA = randomUUID(), runB = randomUUID();
    await repository.createSession(sessionId, "owner", "main");
    const session = await memory.create({ id: sessionId }, TODO_CONTEXT);
    const branch = await session.createBranch("main", null, TODO_CONTEXT);
    await branch.appendMessage({ role: "user", content: "first", timestamp: Date.now() }, TODO_CONTEXT);
    const first = (await session.findEntries({ order: "asc" }, TODO_CONTEXT)).at(-1)!;
    await repository.persist(sessionId, [{ kind: "entry", entry: first, runId: runA }]);
    const response = fauxAssistantMessage("reply");
    await branch.appendMessage(response, TODO_CONTEXT);
    const assistant = (await session.findEntries({ order: "asc" }, TODO_CONTEXT)).at(-1)!;
    assert.equal(assistant.type, "message");
    if (assistant.type !== "message" || assistant.message.role !== "assistant") throw Error("Missing assistant");
    const usageId = randomUUID();
    await repository.persist(sessionId, [
      { kind: "entry", entry: assistant, runId: runA },
      { kind: "usage", row: { id: usageId, seq: 0, entryId: assistant.id,
        usage: assistant.message.usage, adjustment: false }, runId: runA },
    ]);
    const recorded = await sql<{provider:string|null;model:string|null}>`
      SELECT provider, model FROM agent_session.usage_ledger WHERE id=${usageId}`.execute(db);
    assert.equal(recorded.rows[0]?.provider, assistant.message.provider);
    assert.equal(recorded.rows[0]?.model, assistant.message.model);
    await branch.appendMessage({ role: "user", content: "second", timestamp: Date.now() }, TODO_CONTEXT);
    const second = (await session.findEntries({ order: "asc" }, TODO_CONTEXT)).at(-1)!;
    await repository.persist(sessionId, [{ kind: "entry", entry: second, runId: runB }]);
    const firstPage = await repository.history(sessionId, undefined, 1);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.entries[0]?.id, second.id);
    const secondPage = await repository.history(sessionId, firstPage.nextCursor!, 1);
    assert.equal(secondPage.entries[0]?.id, first.id);
    assert.equal(secondPage.hasMore, false);
    const restoredRepo = new MemorySessionRepo();
    try {
      const restored = await restoredRepo.create({ id: sessionId }, TODO_CONTEXT);
      await restoreCheckpoint(restored, sessionId, repository);
      assert.deepEqual((await restored.findEntries({ order: "asc" }, TODO_CONTEXT)).map(entry => entry.id), [first.id, assistant.id, second.id]);
      assert.equal((await repository.loadUsage(sessionId)).length, 1);
      assert.equal(await (await restored.branch("main", TODO_CONTEXT))!.getTipId(TODO_CONTEXT), second.id);
    } finally { await restoredRepo.close(TODO_CONTEXT); }
  } finally {
    await memory.close(TODO_CONTEXT);
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
