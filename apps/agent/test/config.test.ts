import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { readAgentDefinitions } from "../src/config/agent-config.js";
import { SkillLoader } from "../src/skills/loader.js";

function fixture(content: string, skill = false): { root: string; config: string; skills: string } {
  const root = mkdtempSync(resolve(tmpdir(), "fanto-agent-"));
  const skills = resolve(root, "skills");
  mkdirSync(skills);
  if (skill) {
    mkdirSync(resolve(skills, "repo-conventions"));
    writeFileSync(resolve(skills, "repo-conventions", "SKILL.md"), "---\nname: repo-conventions\ndescription: Follow repository conventions.\n---\nRead AGENTS.md first.\n");
  }
  const config = resolve(root, "agents.yaml");
  writeFileSync(config, content);
  return { root, config, skills };
}

test("loads merged DeepSeek definitions with explicit ids, compaction and skills", () => {
  const files = fixture(`version: 1\ndefaults:\n  provider: deepseek\n  model: deepseek-v4-pro\n  tools: [read, write]\n  compaction:\n    enabled: true\n    reserveTokens: 16384\n    keepRecentTokens: 20000\nagents:\n  - id: coding\n    systemPrompt: Work carefully.\n    skills: [repo-conventions]\n`, true);
  try {
    const definitions = readAgentDefinitions(files.config, builtinModels(), new SkillLoader(files.skills).ids());
    assert.deepEqual(definitions[0]?.tools, ["read", "write"]);
    assert.equal(definitions[0]?.compaction.keepRecentTokens, 20_000);
    assert.deepEqual(definitions[0]?.skills, ["repo-conventions"]);
    assert.match(definitions[0]?.revision ?? "", /^[a-f0-9]{64}$/);
  } finally { rmSync(files.root, { recursive: true, force: true }); }
});

test("rejects duplicate agent ids", () => {
  const files = fixture(`version: 1\ndefaults:\n  provider: deepseek\n  model: deepseek-v4-pro\n  compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 }\nagents:\n  - id: coding\n    systemPrompt: First.\n  - id: coding\n    systemPrompt: Second.\n`);
  try {
    assert.throws(() => readAgentDefinitions(files.config, builtinModels(), new Set()), /Duplicate agent id/);
  } finally { rmSync(files.root, { recursive: true, force: true }); }
});

test("rejects duplicate tools", () => {
  const files = fixture(`version: 1\ndefaults:\n  provider: deepseek\n  model: deepseek-v4-pro\n  compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 }\nagents:\n  - id: coding\n    systemPrompt: Work carefully.\n    tools: [read, read]\n`);
  try {
    assert.throws(() => readAgentDefinitions(files.config, builtinModels(), new Set()), /duplicate tools/);
  } finally { rmSync(files.root, { recursive: true, force: true }); }
});
