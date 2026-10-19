import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { AgentRegistry } from "./registry.js";
import { SkillLoader } from "../skills/loader.js";

test("agent.yaml registers only conversational and creative agents", () => {
  const registry = new AgentRegistry(resolve("agent.yaml"), builtinModels(), new SkillLoader(resolve("skills")));
  assert.deepEqual(registry.get("main")?.tools, ["record_read", "memory_manage", "present_media"]);
  assert.equal(registry.get("task-worker"), undefined);
  assert.equal(registry.get("main")?.tools.some(tool => tool.includes("task")), false);
});

test("creative agents expose permitted tools and object-root schemas", async () => {
  const registry = new AgentRegistry(resolve("agent.yaml"), builtinModels(), new SkillLoader(resolve("skills")));
  assert.deepEqual(registry.get("proposal-agent")?.tools, ["read", "write", "edit", "bash", "record_read", "project_read", "proposal_create", "skill_read"]);
  assert.deepEqual(registry.get("creator-agent")?.tools, ["read", "write", "edit", "bash", "record_read", "project_read", "image_generate", "image_review", "project_manage", "skill_read"]);
  assert.deepEqual(registry.get("proposal-agent")?.skills, ["creative-opportunity"]);
  assert.deepEqual(registry.get("creator-agent")?.skills, ["aesthetic-judgment", "artistic-thinking", "intellectual-depth", "emotional-nuance"]);
  assert.deepEqual(registry.get("proposal-agent")?.skills.filter(id => registry.get("creator-agent")?.skills.includes(id)), []);
  const { createTools } = await import("../tools/index.js");
  const skills = new SkillLoader(resolve("skills"));
  for (const tool of createTools(registry.get("creator-agent")!.tools, process.cwd(), {} as never, skills, registry.get("creator-agent")!.skills)) assert.equal((tool.parameters as { type?: string }).type, "object");
});

test("Proposal and Creator skill overlap is rejected at config loading", () => {
  const dir=mkdtempSync(join(tmpdir(),"fanto-skill-test-"));
  try {
    const config=readFileSync(resolve("agent.yaml"),"utf8");
    writeFileSync(join(dir,"agent.yaml"),config.replace("skills: [aesthetic-judgment, artistic-thinking", "skills: [creative-opportunity, aesthetic-judgment, artistic-thinking"));
    assert.throws(()=>new AgentRegistry(join(dir,"agent.yaml"),builtinModels(),new SkillLoader(resolve("skills"))),/cannot share skills/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
