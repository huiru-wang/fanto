import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp, logSafeBody } from "../bootstrap/app.js";
import { FantoService, DEFAULT_CHARACTER, type CharacterPrompt } from "../domain/fanto/index.js";
import { createDatabase, runMigrations } from "../infrastructure/database/database.js";
import { CharacterProvider } from "../agent/context/providers/character.js";
import { createSystemPrompt } from "../agent/context/system-prompt.js";
import { createRunContext } from "../agent/context/run-context.js";
import { mainPrompt } from "../agent/prompts/main.js";

function appFor(character: Pick<FantoService, "getLegacyCharacter" | "replaceLegacyCharacter">) {
  return createApp({
    fanto: character as FantoService, records: {} as never, media: {} as never,
    auth: { verifyAccess: async (userId: string) => ({ userId }), assertActiveUser: async () => {} } as never,
  });
}

async function result(response: Response): Promise<CharacterPrompt> {
  return ((await response.json()) as { result: CharacterPrompt }).result;
}

const config: CharacterPrompt = { character: "朋友", scenario: "散步", instructions: "简洁", exampleDialogues: "你好" };

test("character HTTP authenticates, validates full replacement and rejects identity overrides", async () => {
  const values = new Map<string, CharacterPrompt>();
  const app = appFor({ getLegacyCharacter: async id => values.get(id) ?? { ...DEFAULT_CHARACTER }, replaceLegacyCharacter: async (id, value) => { values.set(id, value); return value; } });
  assert.equal((await app.request("/api/character")).status, 401);
  const headers = { Authorization: "Bearer alice", "Content-Type": "application/json" };
  for (const body of ["{", "null", "{}", JSON.stringify({ ...config, userId: "bob" }), JSON.stringify({ ...config, character: "x".repeat(16001) }), JSON.stringify({ ...config, instructions: 1 })]) {
    assert.equal((await app.request("/api/character", { method: "PUT", headers, body })).status, 400);
  }
  assert.equal(values.size, 0);
  assert.equal((await app.request("/api/character", { method: "PUT", headers, body: JSON.stringify(config) })).status, 200);
  assert.deepEqual(await result(await app.request("/api/character", { headers })), config);
  assert.deepEqual(await result(await app.request("/api/character", { headers: { Authorization: "Bearer bob" } })), DEFAULT_CHARACTER);
  assert.equal((await app.request("/api/character", { method: "DELETE", headers })).status, 404);
  assert.equal(logSafeBody("/api/character", config), "[REDACTED]");
});

test("character PostgreSQL singleton, HTTP roundtrip and same-session prompt refresh", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL!);
  const users = [randomUUID(), randomUUID()];
  try {
    await runMigrations(db);
    const now = new Date();
    await db.insertInto("users").values(users.map(user_id => ({ user_id, status: "active" as const, created_at: now, updated_at: now, disabled_at: null }))).execute();
    const service = FantoService.create(db, {} as never);
    const app = appFor(service);
    const headers = { Authorization: `Bearer ${users[0]}`, "Content-Type": "application/json" };
    const put = async (value: CharacterPrompt) => {
      const response = await app.request("/api/character", { method: "PUT", headers, body: JSON.stringify(value) });
      assert.equal(response.status, 200);
      assert.deepEqual(await result(response), value);
    };
    assert.deepEqual(await service.getLegacyCharacter(users[0]!), DEFAULT_CHARACTER);
    await put(config);
    const prompt = createSystemPrompt({ template: mainPrompt, providers: [new CharacterProvider({ getFantoConversationSettings: ctx => service.getConversationSettings(ctx.userId) })] });
    const run = (runId: string) => createRunContext({ runId, userId: users[0]!, sessionId: "same-session", query: "你好", slots: {}, recentMessages: [] });
    const firstRun = run("first");
    const first = await prompt.resolve({} as never, firstRun);
    assert.ok(first.includes("### 身份与性格\n朋友"));
    assert.ok(first.includes("### 互动方式与边界\n简洁"));
    const updated = { character: "导师", scenario: "", instructions: "", exampleDialogues: "" };
    await put(updated);
    assert.equal(await prompt.resolve({} as never, firstRun), first);
    assert.ok((await prompt.resolve({} as never, run("second"))).includes("### 身份与性格\n导师"));
    assert.deepEqual(await result(await app.request("/api/character", { headers })), updated);
    assert.deepEqual(await service.getLegacyCharacter(users[1]!), DEFAULT_CHARACTER);
    assert.equal((await db.selectFrom("user_fanto_settings").selectAll().where("user_id", "=", users[0]!).execute()).length, 1);
    await put({ character: "", scenario: "", instructions: "", exampleDialogues: "" });
    assert.ok((await prompt.resolve({} as never, run("third"))).includes(DEFAULT_CHARACTER.character));
    await db.deleteFrom("users").where("user_id", "=", users[0]!).execute();
    assert.equal((await db.selectFrom("user_fanto_settings").selectAll().where("user_id", "=", users[0]!).execute()).length, 0);
  } finally {
    await db.deleteFrom("users").where("user_id", "in", users).execute();
    await db.destroy();
  }
});


test("character provider snapshots identity once per run and propagates unavailable settings", async () => {
  let calls = 0;
  const provider = new CharacterProvider({ getFantoConversationSettings: async () => {
    calls++;
    return { nickname: "月见灯", ...config };
  } });
  const prompt = createSystemPrompt({ template: mainPrompt, providers: [provider] });
  const run = createRunContext({ runId: "snapshot", userId: "owner", sessionId: "same", query: "你好", slots: {}, recentMessages: [] });
  const first = await prompt.resolve({} as never, run);
  assert.ok(first.includes('"nickname":"月见灯"'));
  assert.ok(first.includes("nickname 是你面向用户使用的角色名称"));
  assert.ok(first.includes("用户称呼仅从用户本人表达或可信的用户记忆判断"));
  assert.equal(await prompt.resolve({} as never, run), first);
  assert.equal(calls, 1);
  const broken = createSystemPrompt({ template: mainPrompt, providers: [new CharacterProvider({ getFantoConversationSettings: async () => { throw new Error("settings unavailable"); } })] });
  const next = createRunContext({ runId: "failure", userId: "owner", sessionId: "same", query: "你好", slots: {}, recentMessages: [] });
  await assert.rejects(broken.resolve({} as never, next), /settings unavailable/);
});
