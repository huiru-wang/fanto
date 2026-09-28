import type { Models } from "@earendil-works/pi-ai";
import { readAgentDefinitions, type AgentDefinition } from "./definition.js";
import type { SkillLoader } from "../skills/loader.js";

export class AgentRegistry {
  private readonly definitions: ReadonlyMap<string, AgentDefinition>;

  constructor(
    configPath: string,
    models: Models,
    skills: SkillLoader,
  ) {
    const entries = readAgentDefinitions(configPath, models, skills.ids());
    if (!entries.some(definition => definition.id === "main")) {
      throw new Error('Invalid agents.yaml: default agent "main" is required');
    }
    this.definitions = new Map(entries.map(definition => [definition.id, definition]));
  }

  get(id?: string): AgentDefinition | undefined {
    return this.definitions.get(id ?? "main");
  }
}
