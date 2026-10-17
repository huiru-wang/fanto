import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import type { DB } from "../../infrastructure/database/schema.js";
import { createAgentSessionSchema } from "../../migrations/create_current_schema_20261011.js";
import { up as snapshots } from "../../migrations/z_agent_session_snapshots_20261017.js";
import { PgSnapshotStore } from "./session-snapshots.js";
import { PgSessionRepo } from "./pg-session-repo.js";
import { LiveSessionRepo } from "./live-session-repo.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
integration("PostgreSQL snapshots: legacy stable history hydrates, revisions are monotonic, and cold reload preserves identity", async () => {
  if (!/test/i.test(new URL(url!).pathname)) throw Error("Dedicated test database required");
  const admin = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }) });
  const name = `snapshot_test_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const connection = new URL(url!); connection.pathname = `/${name}`;
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: connection.href }) }) });
  const legacy = new PgSessionRepo(db);
  const live = new LiveSessionRepo(db);
  try {
    await createAgentSessionSchema(db); await snapshots(db);
    const old = await legacy.create({ id: randomUUID() }, TODO_CONTEXT);
    const branch = await old.createBranch("main", null, TODO_CONTEXT);
    await branch.appendCustomEntry("fanto.session_owner", { userId: "owner", agentId: "main", revision: "v1" }, TODO_CONTEXT);
    await branch.appendMessage({ role: "user", content: "old message", timestamp: 123 }, TODO_CONTEXT);
    const tip = await branch.getTipId(TODO_CONTEXT);
    const before = await old.findEntries({ order: "asc" }, TODO_CONTEXT);
    await old.close(TODO_CONTEXT);
    const metadata = await live.getById(old.metadata.id, "owner"); assert.ok(metadata);
    const restored = await live.open(metadata);
    const entries = await restored.findEntries({ order: "asc" }, TODO_CONTEXT);
    assert.deepEqual(entries.map(entry => entry.id), before.map(entry => entry.id));
    assert.equal(await (await restored.branch("main", TODO_CONTEXT))!.getTipId(TODO_CONTEXT), tip);
    await live.checkpoint(metadata.id, "owner", "main"); await live.writer.flush();
    const store = new PgSnapshotStore(db);
    const snapshot = await store.read(metadata.id, "owner"); assert.ok(snapshot); assert.equal(snapshot.revision, 1);
    await store.write({ ...snapshot, revision: 20 });
    await store.write({ ...snapshot, revision: 2 });
    await store.write({ ...snapshot, userId: "foreign", revision: 30 });
    assert.equal((await store.read(metadata.id, "owner"))!.revision, 20);
    assert.equal((await store.read(metadata.id, "owner"))!.userId, "owner");
    assert.equal(await store.read(metadata.id, "foreign"), undefined);
    const cold = new LiveSessionRepo(db);
    try {
      const again = await cold.open((await cold.getById(metadata.id, "owner"))!);
      assert.deepEqual((await again.findEntries({ order: "asc" }, TODO_CONTEXT)).map(entry => entry.id), before.map(entry => entry.id));
      await cold.checkpoint(metadata.id, "owner", "main"); await cold.writer.flush();
      assert.equal((await store.read(metadata.id, "owner"))!.revision, 21);
    } finally { await cold.close(); }
  } finally {
    await live.close(); await legacy.close(TODO_CONTEXT); await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin); await admin.destroy();
  }
});
