import { dirname, resolve } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { PreferenceService } from "../domain/preferences/index.js";
import type { RecordService } from "../domain/records/index.js";
import type { MediaService } from "../domain/media/index.js";
import { createAgentBusinessServices } from "./business-services.js";
import { AgentRegistry } from "./harness/registry.js";
import { AgentSessionManager } from "./harness/session-manager.js";
import { SkillLoader } from "./skills/loader.js";

export type AgentRuntime = { registry: AgentRegistry; sessions: AgentSessionManager; close(): Promise<void> };

export function createAgentRuntime(input: {
  records: RecordService;
  media: MediaService;
  preferences: PreferenceService;
  sessionDatabasePath: string;
  workspaceRoot: string;
  definitionPath: string;
}): AgentRuntime {
  const models = builtinModels();
  const skills = new SkillLoader(resolve(dirname(input.definitionPath), "skills"));
  const registry = new AgentRegistry(input.definitionPath, models, skills);
  const sessions = new AgentSessionManager(
    models,
    createAgentBusinessServices(input),
    skills,
    input.sessionDatabasePath,
    input.workspaceRoot,
  );
  return { registry, sessions, close: () => sessions.close() };
}
