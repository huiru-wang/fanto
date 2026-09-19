import type { Models } from "@earendil-works/pi-ai";
import { readAgentDefinitions, type AgentDefinition } from "./agent-config.js";
import type { SkillLoader } from "../skills/loader.js";

export class AgentRegistry {
  private readonly definitions: ReadonlyMap<string, AgentDefinition>;

  constructor(
    configPath: string,
    models: Models,
    skills: SkillLoader,
    modelDefaults: { provider?: string; model?: string } = {},
  ) {
    const entries = readAgentDefinitions(configPath, models, skills.ids(), modelDefaults);
    this.definitions = new Map(entries.map(definition => [definition.id, definition]));
  }

  get(id: string): AgentDefinition | undefined {
    return this.definitions.get(id);
  }
}
