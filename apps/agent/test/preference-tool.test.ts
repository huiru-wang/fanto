import assert from "node:assert/strict";
import test from "node:test";
import { createRunContext } from "../src/harness/run-context.js";
import { createPreferenceManageTool } from "../src/tools/preference-tool.js";

const preference = {
  preferenceId: "p1", userId: "u1", category: "communication" as const, content: "技术方案详细展开",
  sourceSessionId: "s1", sourceMessageId: "m1", sourceQuote: "以后技术方案详细一点",
  version: 1, createdAt: "t", updatedAt: "t",
};

async function execute(tool: any, params: unknown, context: any) {
  return tool.execute("call-1", params, () => {}, {} as never, {} as never, context);
}

test("preference_manage derives identity/provenance from current run and returns refreshed preferences", async () => {
  const calls: any[] = [];
  const client = {
    createPreference: async (ctx: unknown, input: unknown) => { calls.push({ kind: "create", ctx, input }); return { preference, reused: false }; },
    updatePreference: async () => preference,
    deletePreference: async () => ({ preferenceId: "p1" }),
    listPreferences: async (ctx: unknown) => { calls.push({ kind: "list", ctx }); return { data: [preference] }; },
  };
  const tool = createPreferenceManageTool(client as any);
  assert.doesNotMatch(JSON.stringify(tool.parameters), /userId|sessionId|messageId/);
  const context = createRunContext({
    userId: "u1", traceId: "trace-1", sessionId: "s1", sourceMessageId: "m1",
    currentMessage: "以后技术方案详细一点，最好带实现细节。",
  });
  const result = await execute(tool, {
    action: "create", category: "communication", content: "技术方案详细展开", sourceQuote: "以后技术方案详细一点",
  }, context);
  assert.deepEqual(calls[0], {
    kind: "create",
    ctx: { userId: "u1", traceId: "trace-1", signal: undefined },
    input: {
      category: "communication", content: "技术方案详细展开",
      source: { sessionId: "s1", messageId: "m1", quote: "以后技术方案详细一点" },
    },
  });
  assert.equal(result.details.preferences[0].preferenceId, "p1");
});

test("preference_manage rejects inferred or fabricated source quotes", async () => {
  let called = false;
  const client = {
    createPreference: async () => { called = true; return { preference, reused: false }; },
    updatePreference: async () => preference, deletePreference: async () => ({ preferenceId: "p1" }), listPreferences: async () => ({ data: [] }),
  };
  const tool = createPreferenceManageTool(client as any);
  const context = createRunContext({ userId: "u1", sessionId: "s1", sourceMessageId: "m1", currentMessage: "这次简单一点" });
  await assert.rejects(() => execute(tool, {
    action: "create", category: "communication", content: "永远简短", sourceQuote: "以后都简单一点",
  }, context), /continuous exact quote/);
  assert.equal(called, false);
});
