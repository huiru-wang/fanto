import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../infrastructure/database/schema.js";
import { runMigrations } from "../../infrastructure/database/database.js";
import { up as memoryKindsMigration } from "../../migrations/zz_memory_kinds_20261017.js";
import { MemoryService } from "./memory-service.js";
import { memoryKinds } from "./model.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
integration("Memory PostgreSQL: new kinds, untouched legacy rows, progression, isolation and capacity", async () => {
  if (!/test/i.test(new URL(url!).pathname)) throw Error("Dedicated test database required");
  const admin = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }) });
  const name = `memory_test_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const connection = new URL(url!); connection.pathname = `/${name}`;
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: connection.href }) }) });
  let embeddingCalls = 0;
  const vector = Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0);
  const service = MemoryService.create(db, { async embed() { embeddingCalls++; return vector; } });
  try {
    await runMigrations(db);
    for (const id of ["owner", "foreign"]) await db.insertInto("users").values({ user_id: id, status: "active", created_at: new Date(), updated_at: new Date(), disabled_at: null }).execute();
    // Reproduce the previous constraint and a pre-existing row, then apply ONLY DDL.
    await sql`ALTER TABLE memories DROP CONSTRAINT memories_kind_check`.execute(db);
    await sql`ALTER TABLE memories ADD CONSTRAINT memories_kind_check CHECK (kind IN ('profile', 'goal', 'guidance'))`.execute(db);
    const legacyId = randomUUID();
    await sql`INSERT INTO memories VALUES (${legacyId}, 'owner', 'profile', '旧资料不转换', ${JSON.stringify(vector)}::vector, NOW(), NOW())`.execute(db);
    await memoryKindsMigration(db);
    const legacy = (await sql<{ kind: string; content: string }>`SELECT kind, content FROM memories WHERE memory_id=${legacyId}`.execute(db)).rows[0];
    assert.deepEqual(legacy, { kind: "profile", content: "旧资料不转换" });
    assert.deepEqual(await service.list("owner"), []);
    for (const kind of memoryKinds) await service.create("owner", { kind, content: `明确自述:${kind}` });
    const foreign = await service.create("foreign", { kind: "current_focus", content: "别人的关注" });
    const own = await service.list("owner");
    assert.equal(own.length, 4);
    assert.deepEqual(new Set(own.map(row => row.kind)), new Set(memoryKinds));
    const focus = own.find(row => row.kind === "current_focus")!;
    const updated = await service.update("owner", focus.memoryId, { kind: "current_focus", content: "已获得 Offer，尚未决定；此前进入终面" });
    assert.equal(updated?.memoryId, focus.memoryId);
    assert.match(updated!.content, /尚未决定/);
    assert.equal((await service.list("owner")).length, 4);
    assert.equal(await service.update("foreign", focus.memoryId, { kind: "current_focus", content: "越权修改" }), undefined);
    assert.equal(await service.remove("foreign", focus.memoryId), false);
    const found = await service.search("owner", "面试进展");
    assert.equal(found.length, 4);
    assert.ok(found.every(row => row.userId === "owner" && row.memoryId !== legacyId && row.memoryId !== foreign.memoryId));
    const beforeList = embeddingCalls;
    assert.equal((await service.list("owner", { kind: "personal_background" })).length, 1);
    assert.equal(embeddingCalls, beforeList, "injected categories do not request embeddings");
    for (let i = 1; i < 20; i++) await service.create("owner", { kind: "interaction_preferences", content: `偏好${i}` });
    await assert.rejects(service.create("owner", { kind: "interaction_preferences", content: "超过偏好上限" }), /at most 20/);
    await assert.rejects(service.update("owner", focus.memoryId, { kind: "interaction_preferences", content: "不能突破上限" }), /at most 20/);
    await service.update("owner", own.find(row => row.kind === "interaction_preferences")!.memoryId, { kind: "interaction_preferences", content: "容量满仍可更正原偏好" });
    while ((await service.list("owner")).length < 50) await service.create("owner", { kind: "personal_background", content: "容量边界样例" });
    await assert.rejects(service.create("owner", { kind: "personal_background", content: "超过总上限" }), /at most 50/);
    await service.update("owner", focus.memoryId, { kind: "current_focus", content: "已完成求职" });
    assert.equal(await service.remove("owner", focus.memoryId), true);
    assert.equal((await service.search("owner", "求职", 10)).some(row => row.memoryId === focus.memoryId), false);
    assert.equal((await sql`SELECT 1 FROM memories WHERE memory_id=${legacyId}`.execute(db)).rows.length, 1);
    await assert.rejects(service.create("owner", { kind: "profile" as never, content: "不再写旧类型" }), /Unknown memory kind/);
  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin); await admin.destroy();
  }
});
