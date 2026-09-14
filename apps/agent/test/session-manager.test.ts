import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import type { AgentDefinition } from "../src/config/agent-config.js";
import { HarnessFactory } from "../src/harness/harness-factory.js";
import { AgentSessionManager } from "../src/harness/session-manager.js";
import { SkillLoader } from "../src/skills/loader.js";
import { ToolRegistry } from "../src/tools/registry.js";

const definition: AgentDefinition = {
  id: "coding",
  description: "", provider: "deepseek", model: "deepseek-v4-pro", systemPrompt: "You are helpful.",
  tools: ["read", "write", "edit", "bash"], skills: [], compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
};

test("persists the agent binding and restores a SQLite session without a model request", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "fanto-session-"));
  const factory = new HarnessFactory(new ToolRegistry(), new SkillLoader(resolve(root, "skills")));
  const database = resolve(root, "sessions.sqlite");
  const workspaces = resolve(root, "workspaces");
  const first = new AgentSessionManager(factory, database, workspaces);
  try {
    const created = await first.acquire(definition);
    const recorded = await first.entries(created.id, 0, 10);
    assert.equal(recorded.agentId, "coding");
    assert.equal(recorded.entries[0]?.type, "custom");
    assert.deepEqual(await created.lane.getActiveTools(TODO_CONTEXT), ["read", "write", "edit", "bash"]);
    await first.close();

    const restored = new AgentSessionManager(factory, database, workspaces);
    try {
      const resumed = await restored.acquire(definition, created.id);
      assert.equal(resumed.id, created.id);
      assert.equal(resumed.agentId, "coding");
    } finally { await restored.close(); }
  } finally {
    await first.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
