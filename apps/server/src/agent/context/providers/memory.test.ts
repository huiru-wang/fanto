import assert from "node:assert/strict";
import test from "node:test";
import { withAbortSignal } from "@earendil-works/pi-agent-core";
import type { AgentMemory } from "../../business-services.js";
import { createRunContext } from "../run-context.js";
import { createSystemPrompt } from "../system-prompt.js";
import { MemoryProvider, RelevantMemoryProvider, relevantMemoryQuery } from "./memory.js";

const context = () => createRunContext({ runId: "run", userId: "owner", sessionId: "session", query: "hi", slots: {}, recentMessages: [] });
const memory = (kind: AgentMemory["kind"], content: string, memoryId: string = kind): AgentMemory => ({
  memoryId, kind, content, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z",
});

test("only background and preferences are injected; a new run reads updated facts without search", async () => {
  let calls = 0;
  const rows = [memory("important_relationships", "小宝是外甥女"), memory("current_focus", "求职中"), memory("personal_background", "住北京"), memory("interaction_preferences", "简短回答")];
  const provider = new MemoryProvider({ async listMemories(request) {
    assert.equal(request.userId, "owner"); calls++; return rows;
  } });
  const prompt = createSystemPrompt({ template: "{{user_memories}}", providers: [provider] });
  const firstRun = context();
  const first = JSON.parse(await prompt.resolve({} as never, firstRun));
  assert.equal(first.personal_background.entries[0].content, "住北京");
  assert.equal(first.interaction_preferences.entries[0].content, "简短回答");
  assert.equal(JSON.stringify(first).includes("小宝"), false);
  assert.equal(JSON.stringify(first).includes("求职"), false);
  assert.equal(first.personal_background.entries[0].id, "personal_background");
  rows[2] = memory("personal_background", "搬到杭州");
  await prompt.resolve({} as never, firstRun);
  assert.equal(calls, 1);
  const next = JSON.parse(await prompt.resolve({} as never, context()));
  assert.equal(next.personal_background.entries[0].content, "搬到杭州");
  assert.equal(calls, 2);
});

test("serialized budget omits whole entries, preserves preference priority and declares omissions", async () => {
  const rows = [memory("interaction_preferences", "短答"), ...Array.from({ length: 49 }, (_, i) => memory("personal_background", `${i}:${"界".repeat(999)}`, `id-${i}`))];
  const provider = new MemoryProvider({ listMemories: async () => rows });
  const { content } = await provider.build(context());
  assert.ok(Buffer.byteLength(content) <= 12_000);
  const data = JSON.parse(content);
  assert.equal(data.interaction_preferences.entries.length, 1);
  assert.ok(data.personal_background.omitted > 0);
  assert.equal(data.personal_background.entries.length + data.personal_background.omitted, 49);
  for (const entry of data.personal_background.entries) assert.equal(entry.content, rows.find(row => row.memoryId === entry.id)!.content);
});

test("empty and unavailable are distinct, and cancellation is not hidden", async () => {
  const empty = new MemoryProvider({ listMemories: async () => [] });
  assert.equal(JSON.parse((await empty.build(context())).content).status, "empty");
  const failed = new MemoryProvider({ listMemories: async () => { throw Error("database unavailable"); } });
  assert.deepEqual(JSON.parse((await failed.build(context())).content), { status: "unavailable" });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(failed.build(withAbortSignal(controller.signal, context())));
});

test("relevant memory uses filtered one-shot lookup only for continuity cues", async () => {
  let searches = 0;
  const provider = new RelevantMemoryProvider({ async searchMemories(request, options) {
    searches++;
    assert.equal(request.userId, "owner");
    assert.deepEqual(options, { query: "之前我们约定过什么？", limit: 3,
      kinds: ["important_relationships", "current_focus"] });
    return [{ ...memory("current_focus", "正在准备周末行程", "together"), distance: 0.2 }];
  }});
  const skipped = await provider.build(context());
  assert.match(skipped.content, /无需额外检索/);
  assert.equal(searches, 0);
  const recalled = createRunContext({ runId: "r2", userId: "owner", sessionId: "session", query: "之前我们约定过什么？", slots: {}, recentMessages: [] });
  const result = await provider.build(recalled);
  assert.equal(searches, 1);
  const history = JSON.parse(result.content);
  assert.equal(history[0].kind, "current_focus");
  assert.match(history[0].content, /周末/);
  assert.equal(history[0].id, "together");
});

test("relevant memory query carries a short follow-up's nearest user topic and skips unsupported input", () => {
  assert.equal(relevantMemoryQuery("后来呢？", [
    { role: "user", text: "我的朋友最近换工作了" },
    { role: "assistant", text: "助手随意编造的剧情" },
  ]), "我的朋友最近换工作了；后来呢？");
  assert.equal(relevantMemoryQuery("今天天气怎么样？", []), undefined);
  assert.equal(relevantMemoryQuery("你好", []), undefined);
});

test("related memory search failure degrades without claiming empty memory; abort propagates", async () => {
  const provider = new RelevantMemoryProvider({ searchMemories: async () => { throw Error("vector search failed"); } });
  const makeContext = () => createRunContext({ runId: "r3", userId: "owner", sessionId: "session", query: "还记得上次聊天吗", slots: {}, recentMessages: [] });
  assert.match((await provider.build(makeContext())).content, /暂不可用/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(provider.build(withAbortSignal(controller.signal, makeContext())));
});
