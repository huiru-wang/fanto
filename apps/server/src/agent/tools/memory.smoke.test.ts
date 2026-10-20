import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { loadEnv } from "../../bootstrap/config.js";
import { mainPrompt } from "../prompts/main.js";
import { buildRuntime } from "../harness/build-runtime.js";
import { runAgent } from "../harness/run.js";
import { SkillLoader } from "../skills/loader.js";
import type { AgentBusinessServices, AgentMemory } from "../business-services.js";

type Kind = AgentMemory["kind"];
type Seed = { kind: Kind; content: string };
const background: Seed = { kind: "personal_background", content: "用户叫小陆，从事产品设计，常住杭州。" };
const relationship: Seed = { kind: "important_relationships", content: "小宝是用户的女儿。" };
const focus: Seed = { kind: "current_focus", content: "用户正在找远程产品岗位，准备面试。" };
const preference: Seed = { kind: "interaction_preferences", content: "日常聊天简短；倾诉时先倾听，不急于给建议。" };
const mutates = (actions: string[]) => actions.some(action => ["create", "update", "delete"].includes(action));
type Case = { name: string; message: string; seeds?: Seed[]; check(rows: AgentMemory[], actions: string[], answer: string): void };
const creates = (kind: Kind) => (rows: AgentMemory[], actions: string[]) => {
  assert.ok(actions.includes("create"), "must call create, not just say remembered");
  assert.ok(rows.some(row => row.kind === kind));
};
const cases: Case[] = [
  { name: "automatic personal background", message: "我叫小陆，做产品设计，常住杭州。", check: creates("personal_background") },
  { name: "automatic relationship", message: "小宝是我的女儿。", check: creates("important_relationships") },
  { name: "automatic current focus", message: "我最近在找远程产品岗位，正在准备面试。", check: creates("current_focus") },
  { name: "long-term interaction preference", message: "以后日常聊天请简短一些，我倾诉时先听，不急着给建议。", check: creates("interaction_preferences") },
  { name: "correction updates same relationship", seeds: [relationship], message: "小宝不是我的女儿，是我的外甥女，之前说错了。", check(rows, actions) {
    assert.ok(actions.includes("update")); assert.equal(rows.length, 1); assert.match(rows[0]!.content, /外甥女/);
  } },
  { name: "progression updates same focus", seeds: [focus], message: "远程产品岗位的面试已经进入终面了。", check(rows, actions) {
    assert.ok(actions.includes("update")); assert.equal(rows.length, 1); assert.match(rows[0]!.content, /终面/);
  } },
  { name: "completion updates same focus", seeds: [focus], message: "远程岗位求职已经结束了，我决定不换工作了。", check(rows, actions) {
    assert.ok(actions.includes("update")); assert.equal(rows.length, 1); assert.match(rows[0]!.content, /结束|取消|不换|停止/);
  } },
  { name: "duplicate background does not write", seeds: [background], message: "我还是做产品设计，住杭州。", check(_rows, actions) { assert.equal(mutates(actions), false); } },
  { name: "transient mood and this-turn style do not write", seeds: [preference], message: "今天有点累。这次简单说就好。", check(_rows, actions) { assert.equal(mutates(actions), false); } },
  { name: "fiction is not a user fact", message: "我在读一本小说，里面的主角说：我有个儿子叫小石头。这只是小说情节。", check(_rows, actions) { assert.equal(mutates(actions), false); } },
  { name: "related relationship is actively recalled", seeds: [relationship], message: "小宝和我是什么关系来着？", check(_rows, actions, answer) {
    assert.ok(actions.includes("search")); assert.match(answer, /女儿/);
  } },
  { name: "injected background requires no search", seeds: [background], message: "我平时做什么工作？", check(_rows, actions, answer) {
    assert.equal(actions.includes("search"), false); assert.match(answer, /产品设计/);
  } },
];

// Paid opt-in: real model + production prompt/tool/harness; memory I/O is a fixture.
const smoke = process.env.MEMORY_SMOKE_TEST === "1" ? test : test.skip;
smoke("real main model memory policy (independent scenarios)", { timeout: 600_000 }, async t => {
  loadEnv();
  const models = builtinModels();
  for (const scenario of cases) await t.test(scenario.name, { timeout: 50_000 }, async child => {
    const workspace = mkdtempSync(join(tmpdir(), "fanto-memory-smoke-"));
    const repo = new MemorySessionRepo();
    const session = await repo.create({}, TODO_CONTEXT);
    const rows = new Map<string, AgentMemory>();
    for (const [i, seed] of (scenario.seeds ?? []).entries()) rows.set(`seed-${i}`, { ...seed, memoryId: `seed-${i}`, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" });
    const actions: string[] = [];
    const fanto = {
      getFantoConversationSettings: async () => null,
      listRecords: async () => ({ data: [], nextCursor: null, hasMore: false }),
      listMemories: async (_ctx: unknown, input?: { kind?: Kind }) => [...rows.values()].filter(row => !input?.kind || row.kind === input.kind),
      searchMemories: async () => { actions.push("search"); return [...rows.values()].map(row => ({ ...row, distance: 0.1 })); },
      createMemory: async (_ctx: unknown, input: Seed) => {
        actions.push("create");
        const row = { ...input, memoryId: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        rows.set(row.memoryId, row); return row;
      },
      updateMemory: async (_ctx: unknown, id: string, input: Seed) => {
        actions.push("update"); assert.ok(rows.has(id), "must update an existing ID");
        const row = { ...rows.get(id)!, ...input, updatedAt: new Date().toISOString() }; rows.set(id, row); return row;
      },
      deleteMemory: async (_ctx: unknown, id: string) => { actions.push("delete"); rows.delete(id); },
    } as unknown as AgentBusinessServices;
    const runtime = await buildRuntime(session, {
      id: "main", description: "memory smoke", modelId: "deepseek/deepseek-v4-flash", provider: "deepseek", model: "deepseek-v4-flash",
      systemPrompt: mainPrompt, tools: ["user_memory_manage"], skills: [], compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 1024 }, revision: "memory-smoke",
    }, workspace, { models, fanto, skills: new SkillLoader(resolve("skills")) });
    let policySeen = false;
    runtime.harness.hooks.on("before_payload", ({ payload }) => {
      policySeen ||= JSON.stringify(payload).includes("必须在本轮调用工具保存"); return undefined;
    });
    const started = performance.now(); let firstDelta: number | undefined; let lastDelta = started;
    try {
      const answer = await runAgent({ id: session.metadata.id, userId: "synthetic-memory-smoke", agentId: "main", runtime }, scenario.message, AbortSignal.timeout(45_000), { timeZone: "Asia/Shanghai" }, async event => {
        if (event.type === "delta") { firstDelta ??= performance.now(); lastDelta = performance.now(); }
      });
      child.diagnostic(JSON.stringify({ policySeen, actions, firstDeltaMs: firstDelta === undefined ? null : Math.round(firstDelta - started), tailMs: Math.round(performance.now() - lastDelta) }));
      assert.equal(policySeen, true, "policy must reach the actual model payload");
      scenario.check([...rows.values()], actions, answer);
    } finally { await runtime.close(); await repo.close(TODO_CONTEXT); rmSync(workspace, { recursive: true, force: true }); }
  });
});
