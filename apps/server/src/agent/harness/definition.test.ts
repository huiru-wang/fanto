import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { AgentRegistry } from "./registry.js";
import { SkillLoader } from "../skills/loader.js";

test("agent.yaml registers only Main without retired creative agents", () => {
  const registry = new AgentRegistry(resolve("agent.yaml"), builtinModels(), new SkillLoader(resolve("skills")));
  assert.deepEqual(registry.get("main")?.tools, ["record_read", "user_memory_manage", "present_media"]);
  assert.equal(registry.get("task-worker"), undefined);
  assert.equal(registry.get("proposal-agent"), undefined);
  assert.equal(registry.get("creator-agent"), undefined);
  assert.equal(registry.get("main")?.tools.some(tool => tool.includes("task")), false);
});

test("retired tools and prompt modules are rejected by config validation", () => {
  const dir = mkdtempSync(join(tmpdir(), "fanto-definition-test-"));
  try {
    const config = readFileSync(resolve("agent.yaml"), "utf8");
    for (const invalid of [config.replace("record_read", "project_read"), config.replace("systemPromptModule: main", "systemPromptModule: creator-agent")]) {
      writeFileSync(join(dir, "agent.yaml"), invalid);
      assert.throws(() => new AgentRegistry(join(dir, "agent.yaml"), builtinModels(), new SkillLoader(resolve("skills"))), /Invalid agents.yaml/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
