import { Type } from "typebox";
import type { SkillLoader } from "../skills/loader.js";
import type { FantoTool } from "./types.js";

const schema = Type.Object({
  skill: Type.String({ minLength: 1, maxLength: 64 }),
  path: Type.String({ minLength: 1, maxLength: 512 }),
}, { additionalProperties: false });

export function createSkillReadTool(loader: SkillLoader, allowedSkillIds: readonly string[]): FantoTool<typeof schema, unknown> {
  return {
    name: "skill_read",
    label: "读取技能说明",
    presentation: { visible: false },
    description: "读取当前 Agent 已声明 Skill 的 SKILL.md 或 references 文件。只能读取所属 Skill 包内的只读文本资源。",
    parameters: schema,
    executionMode: "parallel",
    replay: "safe",
    async execute(_id, input) {
      const content = loader.readFile(allowedSkillIds, input.skill, input.path);
      const details = { skill: input.skill, path: input.path, content };
      return { content: [{ type: "text" as const, text: content }], details };
    },
  };
}
