import assert from "node:assert/strict";
import test from "node:test";
import type { AgentBusinessServices, AgentMemory } from "../business-services.js";
import { createRunContext } from "../context/run-context.js";
import { createMemoryManageTool } from "./memory.js";

const context = () => createRunContext({ runId: "run", userId: "owner", sessionId: "session", sourceMessageId: "message", query: "hi", slots: {}, recentMessages: [] });
const row: AgentMemory = { memoryId: "memory", kind: "current_focus", content: "求职，已进入终面", createdAt: "2026-10-17", updatedAt: "2026-10-17" };

test("topic search and progression updates carry trusted user identity and return the saved value", async () => {
  const calls: string[] = [];
  const client = {
    async searchMemories(request, input) {
      assert.equal(request.userId, "owner"); assert.equal(request.sourceMessageId, "message");
      assert.deepEqual(input, { query: "求职面试进展", limit: 5 }); calls.push("search");
      return [{ ...row, distance: 0.1 }];
    },
    async updateMemory(request, id, input) {
      assert.equal(request.userId, "owner"); assert.equal(id, row.memoryId);
      assert.deepEqual(input, { kind: "current_focus", content: "求职已获得 Offer，尚未决定是否接受" }); calls.push("update");
      return { ...row, ...input };
    },
  } satisfies Partial<AgentBusinessServices>;
  const tool = createMemoryManageTool(client as AgentBusinessServices);
  const invoke = (params: Parameters<typeof tool.execute>[1]) => tool.execute("call", params, () => {}, {} as never, {} as never, context());
  const found = await invoke({ action: "search", query: " 求职面试进展 " });
  assert.equal(found.details?.action, "search");
  const updated = await invoke({ action: "update", memoryId: "memory", kind: "current_focus", content: "求职已获得 Offer，尚未决定是否接受" });
  assert.equal(updated.details?.action, "update");
  assert.match(JSON.stringify(updated.details), /尚未决定/);
  assert.deepEqual(calls, ["search", "update"]);
  await assert.rejects(invoke({ action: "search", query: "q", content: "unexpected" }), /does not accept content/);
});

test("failed writes propagate failure instead of returning a successful memory result", async () => {
  const tool = createMemoryManageTool({ createMemory: async () => { throw Error("embedding unavailable"); } } as unknown as AgentBusinessServices);
  await assert.rejects(tool.execute("call", { action: "create", kind: "personal_background", content: "用户住北京" }, () => {}, {} as never, {} as never, context()), /embedding unavailable/);
});
