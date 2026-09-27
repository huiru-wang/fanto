import assert from "node:assert/strict";
import test from "node:test";
import { ContextBuilder } from "../src/context/builder.js";
import { composePrompt } from "../src/context/composer.js";
import { CharacterProvider } from "../src/context/providers/character.js";
import { MemoryProvider, dedupeRecords, parseRewriteResult } from "../src/context/providers/memory.js";
import { PreferenceProvider } from "../src/context/providers/preference.js";
import { formatEventTime, formatLunarDate, resolveTimeZone } from "../src/context/providers/time.js";
import { ContextRuntime } from "../src/context/runtime.js";

const template = "# Fanto\n\n## Character\n{{character}}\n\n## User Preferences\n{{user_preferences}}\n\n## Relevant Memory\n{{relevant_memory}}";

test("context runtime builds provider fragments that compose into the run prompt", async () => {
  const preferenceCalls: unknown[] = [];
  const searchCalls: unknown[] = [];
  const preferences = {
    listPreferences: async (ctx: unknown) => {
      preferenceCalls.push(ctx);
      return { data: [{
        preferenceId: "p1", userId: "u1", category: "communication" as const, content: "技术方案详细展开",
        sourceSessionId: "s0", sourceMessageId: "m0", sourceQuote: "以后详细一点", version: 2, createdAt: "t", updatedAt: "t",
      }] };
    },
  };
  const memory = {
    searchRecords: async (ctx: unknown, input: any) => {
      searchCalls.push({ ctx, input });
      return { data: input.query === "q1" ? [
        { recordId: "r1", sourceType: "record_text" as const, mediaId: null, snippet: "第一条", distance: 0.3, eventAt: "2026-09-18T00:00:00.000Z" },
        { recordId: "r2", sourceType: "image" as const, mediaId: "i2", snippet: "第二条", distance: 0.2, eventAt: "2026-09-17T00:00:00.000Z" },
      ] : [
        { recordId: "r1", sourceType: "image" as const, mediaId: "i1", snippet: "第一条更相关片段", distance: 0.1, eventAt: "2026-09-18T00:00:00.000Z" },
        { recordId: "r3", sourceType: "record_text" as const, mediaId: null, snippet: "第三条", distance: 0.4, eventAt: "2026-09-16T00:00:00.000Z" },
      ] };
    },
  };
  const rewriter = { rewrite: async () => ["q1", "q2"] };
  const runtime = new ContextRuntime(new ContextBuilder([
    new CharacterProvider(),
    new PreferenceProvider(preferences as any),
    new MemoryProvider(memory as any, rewriter),
  ]));
  const fragments = await runtime.build({
    userId: "u1",
    sessionId: "s1",
    message: "继续聊那个方案",
    recentMessages: [{ role: "user", text: "我们在聊架构" }],
    traceId: "trace-1",
  });
  const prompt = composePrompt(template, fragments);
  assert.doesNotMatch(prompt, /{{character}}|{{user_preferences}}|{{relevant_memory}}/);
  assert.match(prompt, /表达自然、成熟/);
  assert.match(prompt, /preferenceId: p1 \| version: 2/);
  assert.match(prompt, /recordId：r1/);
  assert.match(prompt, /第一条更相关片段/);
  assert.match(prompt, /recordId：r2/);
  assert.doesNotMatch(prompt, /recordId：r3/);
  assert.doesNotMatch(prompt, /mediaId|distance/);
  assert.equal(preferenceCalls.length, 1);
  assert.deepEqual(searchCalls.map((call: any) => call.input), [{ query: "q1", limit: 4 }, { query: "q2", limit: 4 }]);
});

test("context runtime is independently buildable from prompt composition", async () => {
  const runtime = new ContextRuntime(new ContextBuilder([{
    name: "memory",
    build: async () => ({ section: "Relevant Memory" as const, content: "memory" }),
  }]));
  assert.deepEqual(
    await runtime.build({ userId: "u", sessionId: "s", message: "m", recentMessages: [] }),
    [{ section: "Relevant Memory", content: "memory" }],
  );
});

test("context time uses the Run timezone and falls back safely", () => {
  assert.equal(formatEventTime("2026-09-25T14:18:00.000Z", "Asia/Shanghai"), "2026-09-25 22:18");
  assert.equal(formatLunarDate("2026-09-25T14:18:00.000Z", "Asia/Shanghai"), "农历：丙午年八月十五");
  assert.equal(resolveTimeZone("not-a-timezone"), "UTC");
});

test("query rewrite parser accepts strict JSON and enforces at most two unique queries", () => {
  assert.deepEqual(parseRewriteResult('```json\n{"queries":[" A ","B"]}\n```'), ["A", "B"]);
  assert.deepEqual(parseRewriteResult('{"queries":[]}'), []);
  assert.throws(() => parseRewriteResult('{"queries":["a","b","c"]}'));
});

test("dedupeRecords keeps the best atomic hit per record", () => {
  const hits: any[] = [
    { recordId: "r1", distance: 0.4 },
    { recordId: "r1", distance: 0.1 },
    { recordId: "r2", distance: 0.2 },
  ];
  assert.deepEqual(dedupeRecords(hits).map(hit => [hit.recordId, hit.distance]), [["r1", 0.1], ["r2", 0.2]]);
});
