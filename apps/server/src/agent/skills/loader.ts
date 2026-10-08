import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { Skill } from "@earendil-works/pi-agent-core";

const frontMatter = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), description: z.string().min(1) }).passthrough();
const MAX_SKILL_FILE_BYTES = 64 * 1024;

export class SkillLoader {
  private readonly skills = new Map<string, Skill>();

  constructor(root: string) {
    if (!existsSync(root)) return;
    for (const id of readdirSync(root)) {
      const directory = resolve(root, id);
      const filePath = resolve(directory, "SKILL.md");
      if (!statSync(directory).isDirectory() || !existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf8");
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) throw new Error('Skill "' + id + '" must begin with YAML front matter');
      const document = parseDocument(match[1], { uniqueKeys: true });
      if (document.errors.length > 0) throw new Error('Invalid skill "' + id + '": ' + document.errors.map(error => error.message).join("; "));
      const metadata = frontMatter.safeParse(document.toJS());
      if (!metadata.success || metadata.data.name !== id) throw new Error('Invalid skill metadata for "' + id + '"');
      this.skills.set(id, { name: id, description: metadata.data.description, content, filePath });
    }
  }

  ids(): ReadonlySet<string> {
    return new Set(this.skills.keys());
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  load(ids: readonly string[]): Skill[] {
    return ids.map(id => {
      const skill = this.skills.get(id);
      if (!skill) throw new Error('Unknown skill "' + id + '"');
      return skill;
    });
  }

  readFile(allowedSkillIds: readonly string[], skillId: string, relativePath: string): string {
    if (!allowedSkillIds.includes(skillId)) throw new Error("SKILL_NOT_ALLOWED");
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error("SKILL_NOT_FOUND");
    if (!relativePath || isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) throw new Error("INVALID_SKILL_PATH");

    const root = dirname(skill.filePath);
    const candidate = resolve(root, relativePath);
    const lexical = relative(root, candidate);
    if ((lexical.startsWith("..") || isAbsolute(lexical)) && candidate !== skill.filePath) throw new Error("INVALID_SKILL_PATH");
    if (!existsSync(candidate)) throw new Error("SKILL_FILE_NOT_FOUND");
    if (lstatSync(candidate).isSymbolicLink()) throw new Error("SKILL_FILE_SYMLINK_NOT_ALLOWED");

    const realRoot = realpathSync(root);
    const realCandidate = realpathSync(candidate);
    const canonical = relative(realRoot, realCandidate);
    if (canonical.startsWith("..") || isAbsolute(canonical)) throw new Error("INVALID_SKILL_PATH");
    const stat = statSync(realCandidate);
    if (!stat.isFile()) throw new Error("SKILL_FILE_NOT_FOUND");
    if (stat.size > MAX_SKILL_FILE_BYTES) throw new Error("SKILL_FILE_TOO_LARGE");
    return readFileSync(realCandidate, "utf8");
  }
}
