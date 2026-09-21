import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { readAgentDefinitions } from "../src/agent/definition.js";
import { AgentRegistry } from "../src/agent/registry.js";
import { SkillLoader } from "../src/skills/loader.js";

const model = `models:
  - provider: deepseek
    model: deepseek-v4-pro
`;
const compaction = `compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 }`;

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

test("loads agents that reference a configured model", () => {
  const files = fixture(`version: 1
${model}agents:
  - id: main
    model_id: deepseek/deepseek-v4-pro
    systemPrompt: Work carefully.
    tools: [read, write]
    skills: [repo-conventions]
    ${compaction}
`, true);
  try {
    const definition = readAgentDefinitions(files.config, builtinModels(), new SkillLoader(files.skills).ids())[0];
    assert.equal(definition?.modelId, "deepseek/deepseek-v4-pro");
    assert.equal(definition?.provider, "deepseek");
    assert.equal(definition?.model, "deepseek-v4-pro");
    assert.deepEqual(definition?.tools, ["read", "write"]);
    assert.match(definition?.revision ?? "", /^[a-f0-9]{64}$/);
  } finally { rmSync(files.root, { recursive: true, force: true }); }
});

test("rejects duplicate agent ids, duplicate model ids, and unknown model references", () => {
  const duplicateAgent = fixture(`version: 1
${model}agents:
  - id: main
    model_id: deepseek/deepseek-v4-pro
    systemPrompt: First.
    ${compaction}
  - id: main
    model_id: deepseek/deepseek-v4-pro
    systemPrompt: Second.
    ${compaction}
`);
  const duplicateModel = fixture(`version: 1
${model}  - provider: deepseek
    model: deepseek-v4-pro
agents:
  - id: main
    model_id: deepseek/deepseek-v4-pro
    systemPrompt: First.
    ${compaction}
`);
  const missingModel = fixture(`version: 1
${model}agents:
  - id: main
    model_id: missing
    systemPrompt: First.
    ${compaction}
`);
  try {
    assert.throws(() => readAgentDefinitions(duplicateAgent.config, builtinModels(), new Set()), /Duplicate agent id/);
    assert.throws(() => readAgentDefinitions(duplicateModel.config, builtinModels(), new Set()), /Duplicate model id/);
    assert.throws(() => readAgentDefinitions(missingModel.config, builtinModels(), new Set()), /unknown model_id/);
  } finally {
    for (const files of [duplicateAgent, duplicateModel, missingModel]) rmSync(files.root, { recursive: true, force: true });
  }
});

test("requires the main Agent when constructing the registry", () => {
  const files = fixture(`version: 1
${model}agents:
  - id: coding
    model_id: deepseek/deepseek-v4-pro
    systemPrompt: Work carefully.
    ${compaction}
`);
  try {
    assert.throws(() => new AgentRegistry(files.config, builtinModels(), new SkillLoader(files.skills)), /default agent "main" is required/);
  } finally { rmSync(files.root, { recursive: true, force: true }); }
});

test("resolves main when no agent id is supplied", () => {
  const files = fixture(`version: 1
${model}agents:
  - id: main
    model_id: deepseek/deepseek-v4-pro
    systemPrompt: Work carefully.
    ${compaction}
`);
  try {
    const registry = new AgentRegistry(files.config, builtinModels(), new SkillLoader(files.skills));
    assert.equal(registry.get()?.id, "main");
  } finally { rmSync(files.root, { recursive: true, force: true }); }
});

test("loads Fanto prompts for main while coding remains isolated", () => {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const skills = new SkillLoader(resolve(appRoot, "skills"));
  const definitions = readAgentDefinitions(resolve(appRoot, "agents.yaml"), builtinModels(), skills.ids());
  const main = definitions.find(definition => definition.id === "main");
  const coding = definitions.find(definition => definition.id === "coding");
  assert.equal(main?.modelId, "deepseek/deepseek-v4-pro");
  assert.deepEqual(main?.tools, ["record_get", "record_list", "record_search", "present_media", "preference_manage"]);
  assert.match(main?.systemPrompt ?? "", /你是用户的人生助理/);
  assert.match(main?.systemPrompt ?? "", /\{\{current_time\}\}/);
  assert.deepEqual(coding?.tools, ["read", "write", "edit", "bash"]);
});

test("loads a relative systemPromptFile and includes it in the revision", () => {
  const files = fixture(`version: 1
${model}agents:
  - id: main
    model_id: deepseek/deepseek-v4-pro
    systemPromptFile: ./prompts/main.md
    ${compaction}
`);
  try {
    mkdirSync(resolve(files.root, "prompts"));
    const prompt = resolve(files.root, "prompts", "main.md");
    writeFileSync(prompt, "First prompt.");
    const first = readAgentDefinitions(files.config, builtinModels(), new Set())[0];
    writeFileSync(prompt, "Second prompt.");
    const second = readAgentDefinitions(files.config, builtinModels(), new Set())[0];
    assert.equal(first?.systemPrompt, "First prompt.");
    assert.notEqual(first?.revision, second?.revision);
  } finally { rmSync(files.root, { recursive: true, force: true }); }
});
