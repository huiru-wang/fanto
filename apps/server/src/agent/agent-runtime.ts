import type { Kysely } from "kysely";
import type { DB } from "../infrastructure/database/schema.js";
import type { CreativeService } from "../domain/projects/creative-service.js";
import { dirname, resolve } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { RecordService } from "../domain/records/index.js";
import type { MediaService } from "../domain/media/index.js";
import type { TaskService } from "../domain/tasks/index.js";
import type { MemoryService } from "../domain/memory/index.js";
import { createAgentBusinessServices } from "./business-services.js";
import { AgentRegistry } from "./harness/registry.js";
import { AgentSessionManager } from "./harness/session-manager.js";
import { SkillLoader } from "./skills/loader.js";
import { TaskResultPublisher } from "../domain/tasks/result-publisher.js";
import { DeepSeekWebSearchClient } from "./web/deepseek-web-search.js";

export type AgentRuntime = { registry: AgentRegistry; sessions: AgentSessionManager; close(): Promise<void> };

export function createAgentRuntime(input: {
  records: RecordService;
  creative?: CreativeService;
  media: MediaService;
  tasks: TaskService;
  memories: MemoryService;
  db: Kysely<DB>;
  workspaceRoot: string;
  definitionPath: string;
  deepseekApiKey: string;
}): AgentRuntime {
  const models = builtinModels();
  const skills = new SkillLoader(resolve(dirname(input.definitionPath), "skills"));
  const registry = new AgentRegistry(input.definitionPath, models, skills);
  const taskAgents = registry.taskAgents();
  if (registry.get("main")?.tools.includes("create_task") && taskAgents.length !== 1) {
    throw new Error('Agent "main" currently requires exactly one task-enabled sub-agent');
  }
  const fanto = createAgentBusinessServices({
    ...input,
    taskResultPublisher: new TaskResultPublisher(input.media),
    webSearch: new DeepSeekWebSearchClient(input.deepseekApiKey),
    resolveTaskAgent(agentId) {
      const definition = registry.get(agentId);
      if (!definition || definition.id === "main" || !definition.task?.enabled) return undefined;
      return {
        defaultTimeoutSeconds: definition.task.defaultTimeoutSeconds,
        maxTimeoutSeconds: definition.task.maxTimeoutSeconds,
      };
    },
  });
  const sessions = new AgentSessionManager(
    models,
    fanto,
    skills,
    taskAgents,
    input.db,
    input.workspaceRoot,
  );
  return { registry, sessions, close: () => sessions.close() };
}
