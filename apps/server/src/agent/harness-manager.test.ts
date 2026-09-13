import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { AgentHarnessManager } from "./harness-manager.js";
import type { AppConfig } from "../env.js";

const agentDefinitionsDir = resolve(process.cwd(), "src/agent/definitions");
const sessionId = "550e8400-e29b-41d4-a716-446655440000";

function config(directory: string): AppConfig {
  return {
    provider: "deepseek", model: "deepseek-v4-flash", sqlitePath: join(directory, "app.sqlite"), promptsDir: directory,
    port: 0, host: "127.0.0.1", organizerCron: "", embeddingApiKey: null, embeddingApiBase: "", embeddingModel: "", embeddingDimension: 0,
    oss: { region: "", bucket: "", accessKeyId: "", accessKeySecret: "" },
    dashscope: { apiKey: "", asrBaseUrl: "", vlBaseUrl: "" },
    agentWorkspaceRoot: join(directory, "workspaces"), agentSessionDatabasePath: join(directory, "sessions.sqlite"), agentDefinitionsDir,
  };
}

test("Pi SQLite Session is the durable source for agent ownership and transcript entries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fanto-agent-"));
  try {
    const first = new AgentHarnessManager(config(directory));
    const created = await first.getOrCreate("user-a", sessionId);
    assert.ok(created);
    assert.deepEqual(await created.lane.getActiveTools((await import("@earendil-works/pi-agent-core")).TODO_CONTEXT), ["read", "write", "edit", "bash"]);
    assert.equal((await first.entries("user-a", sessionId))?.[0]?.type, "custom");
    assert.equal(await first.getOrCreate("user-b", sessionId, "main"), null);
    await first.close();

    const restored = new AgentHarnessManager(config(directory));
    assert.ok(await restored.getOrCreate("user-a", sessionId));
    assert.equal(await restored.getOrCreate("user-b", sessionId, "main"), null);
    await restored.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
