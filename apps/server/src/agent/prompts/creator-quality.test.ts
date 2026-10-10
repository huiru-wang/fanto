import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { creatorAgentPrompt } from "./creator-agent.js";
import { proposalAgentPrompt } from "./proposal-agent.js";
import { SkillLoader } from "../skills/loader.js";

const root = resolve(process.cwd(), "skills");
const loader = new SkillLoader(root);
const creatorSkillIds = [
  "aesthetic-judgment", "artistic-thinking", "intellectual-depth", "emotional-nuance",
];

test("Creator follows Ground / Create / Refine / Save with Goal as the primary authority", () => {
  const names = ["Ground｜", "Create｜", "Refine｜", "Save｜"];
  const offsets = names.map(name => creatorAgentPrompt.indexOf(name));
  assert.ok(offsets.every(offset => offset > -1));
  assert.deepEqual(offsets, [...offsets].sort((a,b)=>a-b));
  assert.match(creatorAgentPrompt, /Goal 已决定做什么/);
  assert.match(creatorAgentPrompt, /一个或多个关联 Records/);
  assert.match(creatorAgentPrompt, /Extend：同时理解已有 Project/);
  assert.match(creatorAgentPrompt, /按问题需要/);
  assert.match(creatorAgentPrompt, /不是决定内容类型或目标的任务模板/);
  assert.doesNotMatch(creatorAgentPrompt, /creative-direction|creative-review|Direct（|Make（/);
  for (const part of ["瞬间", "碎片", "想法"]) assert.ok(creatorAgentPrompt.includes(part));
});

test("Creator keeps existing save and media review guardrails", () => {
  for (const expected of ["expectedVersion","VERSION_CONFLICT","image_generate","image_review",
    "referenceMediaIds","fanto-media://mediaId","保存成功","用户如果已经有这些 Record 和图片"]) {
    assert.ok(creatorAgentPrompt.includes(expected), expected);
  }
  assert.match(creatorAgentPrompt,/无实际浏览器渲染工具时不能宣称/);
  assert.match(creatorAgentPrompt,/实际产出对应视觉内容/);
});

test("Proposal owns Project-first / Record-second and reads one Skill after verified linkage", () => {
  const project = proposalAgentPrompt.indexOf("Project-first");
  const record = proposalAgentPrompt.indexOf("Record-second");
  const gate = proposalAgentPrompt.indexOf("Evidence Gate");
  const skill = proposalAgentPrompt.indexOf("Value Discovery");
  assert.ok(project >= 0 && project < record && record < gate && gate < skill);
  for(const required of ["proposal_record","proposal_projects","project_read","record_read",
    "creative-opportunity","enrich","correct","refine","continue","no_proposal","opening"]) {
    assert.ok(proposalAgentPrompt.includes(required), required);
  }
  assert.doesNotMatch(proposalAgentPrompt,/project-evolution|creative_context/);
  assert.match(proposalAgentPrompt,/没有可靠 Project\/历史 Record 锚点/);
});

test("new methodology Skills have valid references and removed domain-process skills are gone", () => {
  for (const old of ["art-direction","creative-direction","photography","storytelling",
    "editorial-design","image-creation","creative-review","project-evolution"]) {
    assert.equal(loader.get(old), undefined,old);
  }
  const skills = [...creatorSkillIds, "creative-opportunity"];
  for (const name of skills) {
    const skill = loader.get(name);
    assert.ok(skill, "missing Skill: "+name);
    assert.match(skill!.content,/version: \d+\.\d+\.\d+/);
    for (const ref of skill!.content.matchAll(/references\/[a-z0-9-]+\.md/g)) {
      const file = resolve(root,name,ref[0]);
      assert.ok(existsSync(file),file);
      assert.ok(readFileSync(file,"utf8").trim().length>60,file);
    }
  }
  for (const skill of creatorSkillIds) assert.ok(!proposalAgentPrompt.includes(skill));
  assert.match(loader.get("creative-opportunity")!.content,/不得检查 Creator 当前可交付性/);
  assert.match(loader.get("creative-opportunity")!.content,/延续|Extend/);
});
