import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../infrastructure/database/schema.js";
import { runMigrations } from "../../infrastructure/database/database.js";
import { AdminRepository } from "./admin-repository.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
integration("admin repository reads only user/session-scoped usage, including adjustment rows", async () => {
  if (!/test/i.test(new URL(url!).pathname)) throw new Error("Dedicated test database required");
  const adminDb = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }) });
  const name = `admin_usage_test_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(adminDb);
  const connection = new URL(url!); connection.pathname = `/${name}`;
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: connection.href }) }) });
  try {
    await runMigrations(db);
    const a = "admin-user-a", b = "admin-user-b";
    await db.insertInto("users").values([a,b].map(user_id => ({ user_id, status: "active" as const, created_at: new Date(), updated_at: new Date(), disabled_at: null }))).execute();
    await db.insertInto("user_profiles").values({ user_id: a, nickname: "A", signature: "", avatar_media_id: null, cover_media_id: null, version: 1, updated_at: new Date() }).execute();
    const sessionA = randomUUID(), sessionB = randomUUID(), otherUser = randomUUID();
    for (const [id,user_id] of [[sessionA,a],[sessionB,a],[otherUser,b]])
      await sql`INSERT INTO agent_session.sessions (id,user_id,agent_id,scope_key,created_at,updated_at,next_seq)
        VALUES (${id},${user_id},'main',${id},1000,1000,0)`.execute(db);
    const usage = (input: number, output: number) => JSON.stringify({ input, output, cacheRead: 3, cacheWrite: 4,
      totalTokens: input + output + 7, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.005 } });
    for (const [session_id,adjustment,payload] of [[sessionA,false,usage(5,10)],[sessionA,true,usage(7,8)],
      [otherUser,false,usage(999,999)]] as const)
      await sql`INSERT INTO agent_session.usage_ledger (session_id,id,seq,adjustment,usage,provider,model)
        VALUES (${session_id},${randomUUID()},${Math.floor(Math.random()*1e6)},${adjustment},${payload}::jsonb,'deepseek','test-model')`.execute(db);
    const repo = new AdminRepository(db);
    const users = await repo.listUsers({ limit: 20 });
    assert.equal(users.data.length, 2);
    assert.equal(users.data.find(u=>u.userId === a)?.nickname, "A");
    const usageA = (await repo.usageForUsers([a])).get(a);
    assert.equal(usageA?.sessionCount, 2);
    assert.equal(usageA?.usage.input, 12);
    assert.equal(usageA?.usage.output, 18);
    assert.equal(usageA?.usage.totalTokens, 44);
    assert.equal(usageA?.usage.estimatedCost, 0.01);
    assert.equal((await repo.usageForSessions([sessionB])).size, 0);
    assert.equal((await repo.listSessions(a, { limit: 20 })).data.length, 2);
    assert.equal((await repo.sessionModels(sessionA))[0]?.usage.totalTokens, 44);
    assert.equal((await repo.usageForUsers([b])).get(b)?.usage.input, 999);
  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(adminDb);
    await adminDb.destroy();
  }
});
