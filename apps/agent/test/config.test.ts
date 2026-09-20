import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

test("loads Fanto prompt file for main while coding remains isolated", () => {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const skills = new SkillLoader(resolve(appRoot, "skills"));
  const definitions = readAgentDefinitions(resolve(appRoot, "agents.yaml"), builtinModels(), skills.ids());
  const main = definitions.find(definition => definition.id === "main");
  const coding = definitions.find(definition => definition.id === "coding");
  assert.deepEqual(main?.tools, ["record_get", "record_list", "record_search", "present_media"]);
  assert.deepEqual(main?.skills, []);
  assert.match(main?.systemPrompt ?? "", /你是 Fanto/);
  assert.match(main?.systemPrompt ?? "", /record_list/);
  assert.match(main?.systemPrompt ?? "", /record_search/);
  assert.match(main?.systemPrompt ?? "", /record_get/);
  assert.match(main?.systemPrompt ?? "", /工具调用过程必须对用户隐身/);
  assert.match(main?.systemPrompt ?? "", /不能默认是用户本人/);
  assert.match(main?.systemPrompt ?? "", /record_search 已返回真实 mediaId 时，可以直接调用 `present_media`/);
  assert.match(main?.systemPrompt ?? "", /Markdown 只用于最终可见文本/);
  assert.match(main?.systemPrompt ?? "", /present_media/);
  assert.doesNotMatch((main?.tools ?? []).join(","), /read|write|edit|bash/);
  assert.deepEqual(coding?.tools, ["read", "write", "edit", "bash"]);
});

test("loads a relative systemPromptFile and includes its content in revision", () => {
  const files = fixture(`version: 1
defaults:
  provider: deepseek
  model: deepseek-v4-pro
  compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 }
agents:
  - id: main
    systemPromptFile: ./prompts/main.md
`);
  try {
    mkdirSync(resolve(files.root, "prompts"));
    const prompt = resolve(files.root, "prompts", "main.md");
    writeFileSync(prompt, "First prompt.");
    const first = readAgentDefinitions(files.config, builtinModels(), new Set())[0];
    writeFileSync(prompt, "Second prompt.");
    const second = readAgentDefinitions(files.config, builtinModels(), new Set())[0];
    assert.equal(first?.systemPrompt, "First prompt.");
    assert.equal(second?.systemPrompt, "Second prompt.");
    assert.notEqual(first?.revision, second?.revision);
  } finally { rmSync(files.root, { recursive: true, force: true }); }
});

test("rejects ambiguous or unsafe systemPromptFile configuration", () => {
  const both = fixture(`version: 1
defaults:
  provider: deepseek
  model: deepseek-v4-pro
  compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 }
agents:
  - id: main
    systemPrompt: Inline.
    systemPromptFile: ./prompt.md
`);
  const escape = fixture(`version: 1
defaults:
  provider: deepseek
  model: deepseek-v4-pro
  compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 }
agents:
  - id: main
    systemPromptFile: ../prompt.md
`);
  try {
    assert.throws(() => readAgentDefinitions(both.config, builtinModels(), new Set()), /mutually exclusive/);
    assert.throws(() => readAgentDefinitions(escape.config, builtinModels(), new Set()), /inside the config directory/);
  } finally {
    rmSync(both.root, { recursive: true, force: true });
    rmSync(escape.root, { recursive: true, force: true });
  }
});

test("accepts configured Fanto tool names", () => {
  const files = fixture(`version: 1
defaults:
  provider: deepseek
  model: deepseek-v4-pro
  compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 }
agents:
  - id: main
    systemPrompt: Use records carefully.
    tools: [record_get, record_list, record_search, present_media]
`);
  try {
    const definitions = readAgentDefinitions(files.config, builtinModels(), new Set());
    assert.deepEqual(definitions[0]?.tools, ["record_get", "record_list", "record_search", "present_media"]);
  } finally { rmSync(files.root, { recursive: true, force: true }); }
});
