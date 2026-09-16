import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import type { AgentDefinition } from "../src/config/agent-config.js";
import { HarnessFactory } from "../src/harness/harness-factory.js";
import { AgentSessionManager, SessionOwnershipError } from "../src/harness/session-manager.js";
import { SkillLoader } from "../src/skills/loader.js";
import { ToolRegistry } from "../src/tools/registry.js";

const definition: AgentDefinition = {
  id: "coding",
  revision: "coding-v1",
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
    const created = await first.create(definition, "user_1");
    assert.equal(created.agentId, "coding");
    assert.equal(created.userId, "user_1");
    assert.deepEqual(await created.lane.getActiveTools(TODO_CONTEXT), ["read", "write", "edit", "bash"]);
    await first.close();

    const restored = new AgentSessionManager(factory, database, workspaces);
    try {
      const resumed = await restored.acquire(definition, created.id);
      assert.equal(resumed.id, created.id);
      assert.equal(resumed.agentId, "coding");
      assert.equal(resumed.userId, "user_1");
      await assert.rejects(restored.acquire(definition, created.id, "user_2"), SessionOwnershipError);
    } finally { await restored.close(); }
  } finally {
    await first.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test("implicitly switches the agent and replaces persisted active tools", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "fanto-session-switch-"));
  const factory = new HarnessFactory(new ToolRegistry(), new SkillLoader(resolve(root, "skills")));
  const database = resolve(root, "sessions.sqlite");
  const workspaces = resolve(root, "workspaces");
  const first = new AgentSessionManager(factory, database, workspaces);
  const target: AgentDefinition = {
    id: "main", revision: "main-v2", description: "", provider: "deepseek", model: "deepseek-v4-pro", systemPrompt: "Use short answers.",
    tools: ["read"], skills: [], compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
  };
  try {
    const created = await first.create(definition, "user_1");
    const switched = await first.acquire(target, created.id, "user_1");
    assert.equal(switched.agentId, "main");
    assert.equal(switched.userId, "user_1");
    assert.deepEqual(await switched.lane.getActiveTools(TODO_CONTEXT), ["read"]);
    await first.close();

    const restored = new AgentSessionManager(factory, database, workspaces);
    try {
      const resumed = await restored.acquire(target, created.id, "user_1");
      assert.equal(resumed.agentId, "main");
      assert.equal(resumed.revision, "main-v2");
      assert.deepEqual(await resumed.lane.getActiveTools(TODO_CONTEXT), ["read"]);
    } finally { await restored.close(); }
  } finally {
    await first.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
