import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../infrastructure/database/schema.js";
import { runMigrations } from "../../infrastructure/database/database.js";
import { FantoService } from "../../domain/fanto/fanto-service.js";
import { CheckpointRepository } from "./postgres-repository.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;

integration("checkpoint-owned main session selection enforces user ownership and optimistic settings version", async () => {
  if (!/test/i.test(new URL(url!).pathname)) throw new Error("Dedicated test database required");
  const admin = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }) });
  const name = `checkpoint_settings_test_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const connection = new URL(url!); connection.pathname = `/${name}`;
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: connection.href }) }) });
  try {
    await runMigrations(db);
    const now = new Date(), owner = randomUUID(), outsider = randomUUID();
    await db.insertInto("users").values([owner, outsider].map(user_id => ({
      user_id, status: "active" as const, created_at: now, updated_at: now, disabled_at: null,
    }))).execute();
    const checkpoint = new CheckpointRepository(db);
    const mainId = randomUUID(), otherAgentId = randomUUID();
    await checkpoint.createSession(mainId, owner, "main");
    await checkpoint.createSession(otherAgentId, owner, "other-agent");
    const fanto = FantoService.create(db, {validateAvatar: async () => false} as never);
    assert.equal((await fanto.getSettings(owner)).sessionId, null);
    const updated = await fanto.updateSettings(owner, {
      expectedVersion: 0, changes: {sessionId: mainId},
    });
    assert.equal(updated.sessionId, mainId);
    assert.equal((await fanto.getSettings(owner)).sessionId, mainId);
    await assert.rejects(fanto.updateSettings(outsider, {
      expectedVersion: 0, changes: {sessionId: mainId},
    }), {code: "INVALID_SESSION"});
    await assert.rejects(fanto.updateSettings(owner, {
      expectedVersion: updated.version, changes: {sessionId: otherAgentId},
    }), {code: "INVALID_SESSION"});
    await assert.rejects(fanto.updateSettings(owner, {
      expectedVersion: 0, changes: {sessionId: mainId},
    }), {code: "VERSION_CONFLICT"});
    assert.equal((await fanto.updateSettings(owner, {
      expectedVersion: updated.version, changes: {description: "unchanged chat"},
    })).sessionId, mainId);
    const before = await fanto.getSettings(owner);
    const freshId = randomUUID();
    await checkpoint.createSession(freshId, owner, "main");
    const switched = await fanto.updateSettings(owner, {
      expectedVersion: before.version, changes: {sessionId: freshId},
    });
    assert.equal(switched.fantoId, before.fantoId);
    assert.equal(switched.sessionId, freshId);
    assert.equal(switched.description, before.description);
    assert.deepEqual(switched.roleConfig, before.roleConfig);
    assert.equal((await fanto.getSettings(owner)).sessionId, freshId);
    assert.equal((await checkpoint.getSession(mainId, owner))?.id, mainId);
    assert.equal(await checkpoint.getSession(freshId, outsider), undefined);
    await assert.rejects(fanto.updateSettings(owner, {
      expectedVersion: before.version, changes: {sessionId: mainId},
    }), {code: "VERSION_CONFLICT"});
    assert.equal((await fanto.getSettings(owner)).sessionId, freshId);
  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
