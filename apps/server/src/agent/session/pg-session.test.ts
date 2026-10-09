import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import {
  TODO_CONTEXT, insertEntry,
} from "@earendil-works/pi-agent-core";
import {
  createStorageConformance, createSessionRepoConformance,
} from "@earendil-works/pi-agent-core/harness/session/testing";
import type { DB } from "../../infrastructure/database/schema.js";
import { up as migrate } from "../../migrations/zzzzzzzzzzzz_agent_sessions_pg.js";
import { PgSessionRepo } from "./pg-session-repo.js";
import { PgStorage } from "./pg-storage.js";

const testUrl = process.env.TEST_DATABASE_URL;
// Destructive integration suite: only allow explicitly designated test databases.
if (testUrl && !/(^|[_-])test($|[_-])|test$/i.test(decodeURIComponent(new URL(testUrl).pathname.slice(1)))) {
  throw new Error("TEST_DATABASE_URL must point to a dedicated *test* database");
}
let db: Kysely<DB>;

before(async () => {
  if (!testUrl) return;
  db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: testUrl, max: 10 }),
    }),
  });
  await sql`DROP SCHEMA IF EXISTS agent_session CASCADE`.execute(db);
  await migrate(db);
});

beforeEach(async () => {
  if (!testUrl) return;
  // SDK conformance fixtures reuse fixed test IDs; isolate each case.
  await sql`TRUNCATE TABLE
    agent_session.branch_entries, agent_session.branch_meta,
    agent_session.entries, agent_session.scalar_values,
    agent_session.list_values, agent_session.usage_ledger,
    agent_session.sessions`.execute(db);
});

after(async () => {
  if (!testUrl) return;
  await sql`DROP SCHEMA IF EXISTS agent_session CASCADE`.execute(db);
  await db.destroy();
});

// Use the SDK's own exhaustive semantic conformance suites.
for (const c of createStorageConformance(async () => {
  const repo = new PgSessionRepo(db);
  const session = await repo.create({ id: randomUUID() }, TODO_CONTEXT);
  const storage = new PgStorage(db, { sessionId: session.metadata.id });
  return {
    storage,
    async [Symbol.asyncDispose]() {
      await storage.close(TODO_CONTEXT);
      await repo.close(TODO_CONTEXT);
    },
  };
})) {
  test(`PG Storage contract: ${c.group}: ${c.name}`, { skip: !testUrl }, c.run);
}

for (const c of createSessionRepoConformance(async () => new PgSessionRepo(db))) {
  test(`PG SessionRepo contract: ${c.group}: ${c.name}`, { skip: !testUrl }, c.run);
}

test("PG: independent repos persist and reopen a Session", { skip: !testUrl }, async () => {
  const first = new PgSessionRepo(db);
  const id = randomUUID();
  const session = await first.create({ id }, TODO_CONTEXT);
  await session.setName("Session PG restart", TODO_CONTEXT);
  await session.close(TODO_CONTEXT);
  await first.close(TODO_CONTEXT);

  const second = new PgSessionRepo(db);
  const metadata = await second.getById(id);
  assert.equal(metadata?.id, id);
  const reopened = await second.open(metadata!, TODO_CONTEXT);
  assert.equal(await reopened.getName(TODO_CONTEXT), "Session PG restart");
  await second.close(TODO_CONTEXT);
});

test("PG: schemas contain no foreign keys or provider-specific dependencies", { skip: !testUrl }, async () => {
  const constraints = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM information_schema.table_constraints
    WHERE table_schema = 'agent_session' AND constraint_type = 'FOREIGN KEY'
  `.execute(db);
  assert.equal(constraints.rows[0]?.count, "0");
  const names = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'agent_session' AND table_type = 'BASE TABLE'
  `.execute(db);
  assert.deepEqual(names.rows.map(row => row.table_name).sort(), [
    "branch_entries", "branch_meta", "entries", "list_values",
    "scalar_values", "sessions", "usage_ledger",
  ]);
});

test("PG: transaction rollback prevents a partial commit", { skip: !testUrl }, async () => {
  const repo = new PgSessionRepo(db);
  const session = await repo.create({ id: randomUUID() }, TODO_CONTEXT);
  const storage = new PgStorage(db, { sessionId: session.metadata.id });
  const root = randomUUID();
  await storage.commit([insertEntry({ id: root, type: "custom", parentId: null, customType: "test", data: {} })], TODO_CONTEXT);
  await assert.rejects(storage.commit([
    insertEntry({ id: randomUUID(), type: "custom", parentId: root, customType: "test", data: {} }),
    insertEntry({ id: root, type: "custom", parentId: null, customType: "test", data: {} }),
  ], TODO_CONTEXT));
  assert.equal((await storage.scanEntries({}, TODO_CONTEXT)).length, 1);
  assert.equal((await storage.getStats(TODO_CONTEXT)).messageCount, 0);
  await storage.close(TODO_CONTEXT);
  await repo.close(TODO_CONTEXT);
});

test("PG: a second PostgreSQL pool can resume persisted state", { skip: !testUrl }, async () => {
  const writer = new PgSessionRepo(db);
  const session = await writer.create({ id: randomUUID() }, TODO_CONTEXT);
  await session.setName("cross-server state", TODO_CONTEXT);
  const id = session.metadata.id;
  await writer.close(TODO_CONTEXT);
  const otherDb = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: testUrl!, max: 2 }) }),
  });
  try {
    const reader = new PgSessionRepo(otherDb);
    const meta = await reader.getById(id);
    assert.equal(meta?.id, id);
    const reopened = await reader.open(meta!, TODO_CONTEXT);
    assert.equal(await reopened.getName(TODO_CONTEXT), "cross-server state");
    await reader.close(TODO_CONTEXT);
  } finally {
    await otherDb.destroy();
  }
});

test("PG: independent connection pools serialize storage sequence allocation", { skip: !testUrl }, async () => {
  const repo = new PgSessionRepo(db);
  const session = await repo.create({ id: randomUUID() }, TODO_CONTEXT);
  const id = session.metadata.id;
  const otherDb = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: testUrl!, max: 2 }) }),
  });
  const left = new PgStorage(db, { sessionId: id });
  const right = new PgStorage(otherDb, { sessionId: id });
  try {
    const [a, b] = await Promise.all([
      left.commit([insertEntry({ id: randomUUID(), type: "custom", parentId: null, customType: "left", data: {} })], TODO_CONTEXT),
      right.commit([insertEntry({ id: randomUUID(), type: "custom", parentId: null, customType: "right", data: {} })], TODO_CONTEXT),
    ]);
    assert.deepEqual([a.firstSeq, b.firstSeq].sort((x, y) => x - y), [1, 2]);
    assert.equal((await left.scanEntries({}, TODO_CONTEXT)).length, 2);
  } finally {
    await left.close(TODO_CONTEXT);
    await right.close(TODO_CONTEXT);
    await repo.close(TODO_CONTEXT);
    await otherDb.destroy();
  }
});
