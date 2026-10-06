import { dirname, resolve } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { RecordService } from "../domain/records/index.js";
import type { MediaService } from "../domain/media/index.js";
import type { TaskService } from "../domain/tasks/index.js";
import { createAgentBusinessServices } from "./business-services.js";
import { AgentRegistry } from "./harness/registry.js";
import { AgentSessionManager } from "./harness/session-manager.js";
import { SkillLoader } from "./skills/loader.js";
import { TaskResultPublisher } from "../task-runtime/result-publisher.js";
import { DeepSeekWebSearchClient } from "./web/deepseek-web-search.js";

export type AgentRuntime = { registry: AgentRegistry; sessions: AgentSessionManager; close(): Promise<void> };

export function createAgentRuntime(input: {
  records: RecordService;
  media: MediaService;
  tasks: TaskService;
  sessionDatabasePath: string;
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
        maxAttempts: definition.task.maxAttempts,
      };
    },
  });
  const sessions = new AgentSessionManager(
    models,
    fanto,
    skills,
    taskAgents,
    input.sessionDatabasePath,
    input.workspaceRoot,
  );
  return { registry, sessions, close: () => sessions.close() };
}
