import type { Kysely } from "kysely";
import type { DB } from "../infrastructure/database/schema.js";
import { dirname, resolve } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { RecordService } from "../domain/records/index.js";
import type { MediaService } from "../domain/media/index.js";
import type { FantoService } from "../domain/fanto/index.js";
import type { MemoryService } from "../domain/memory/index.js";
import { createAgentBusinessServices } from "./business-services.js";
import { AgentRegistry } from "./harness/registry.js";
import { AgentSessionManager } from "./harness/session-manager.js";
import { SkillLoader } from "./skills/loader.js";

export type AgentRuntime = { registry: AgentRegistry; sessions: AgentSessionManager; close(): Promise<void> };

export function createAgentRuntime(input: {
  records: RecordService;
  media: MediaService;
  memories: MemoryService;
  fanto: FantoService;
  db: Kysely<DB>;
  workspaceRoot: string;
  definitionPath: string;
}): AgentRuntime {
  const models = builtinModels();
  const skills = new SkillLoader(resolve(dirname(input.definitionPath), "skills"));
  const registry = new AgentRegistry(input.definitionPath, models, skills);
  const fanto = createAgentBusinessServices({
    ...input,
  });
  const sessions = new AgentSessionManager(
    models,
    fanto,
    skills,
    input.db,
    input.workspaceRoot,
  );
  return { registry, sessions, close: () => sessions.close() };
}
