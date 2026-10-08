import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SkillLoader } from "./loader.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "fanto-skills-"));
  const allowed = join(root, "allowed");
  const other = join(root, "other");
  mkdirSync(join(allowed, "references"), { recursive: true });
  mkdirSync(other, { recursive: true });
  writeFileSync(join(allowed, "SKILL.md"), "---\nname: allowed\ndescription: Allowed test skill\n---\n\nBody");
  writeFileSync(join(allowed, "references", "guide.md"), "guide");
  writeFileSync(join(other, "SKILL.md"), "---\nname: other\ndescription: Other test skill\n---\n\nOther");
  return { root, allowed };
}

test("SkillLoader reads only files inside an allowed skill", () => {
  const { root } = fixture();
  const loader = new SkillLoader(root);
  assert.equal(loader.readFile(["allowed"], "allowed", "SKILL.md").includes("Allowed test skill"), true);
  assert.equal(loader.readFile(["allowed"], "allowed", "references/guide.md"), "guide");
  assert.throws(() => loader.readFile(["allowed"], "other", "SKILL.md"), /SKILL_NOT_ALLOWED/);
  assert.throws(() => loader.readFile(["allowed"], "allowed", "../other/SKILL.md"), /INVALID_SKILL_PATH/);
  assert.throws(() => loader.readFile(["allowed"], "allowed", "/tmp/file"), /INVALID_SKILL_PATH/);
});

test("SkillLoader rejects symlink skill resources", () => {
  const { root, allowed } = fixture();
  const outside = join(root, "outside.md");
  writeFileSync(outside, "outside");
  symlinkSync(outside, join(allowed, "references", "link.md"));
  const loader = new SkillLoader(root);
  assert.throws(() => loader.readFile(["allowed"], "allowed", "references/link.md"), /SKILL_FILE_SYMLINK_NOT_ALLOWED/);
});
