import { AgentHarness, TODO_CONTEXT, type AgentLane, type ExecutionToolContext, type Session } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { Models } from "@earendil-works/pi-ai";
import type { AgentDefinition } from "./definition.js";
import { resolveRunSystemPrompt } from "./run-context.js";
import type { FantoServerClient } from "../fanto/client.js";
import type { SkillLoader } from "../skills/loader.js";
import { createTools } from "../tools/index.js";
import { assertBashRequest } from "../workspace/bash.js";
import { assertWorkspacePath } from "../workspace/paths.js";

export type HarnessRuntime = {
  harness: AgentHarness<ExecutionToolContext>;
  lane: AgentLane;
};

export type HarnessDependencies = {
  models: Models;
  fanto: FantoServerClient;
  skills: SkillLoader;
};

export async function createHarness(
  session: Session,
  definition: AgentDefinition,
  workspace: string,
  dependencies: HarnessDependencies,
): Promise<HarnessRuntime> {
  const model = dependencies.models.getModel(definition.provider, definition.model);
  if (!model) throw new Error(`Unknown model: ${definition.provider}/${definition.model}`);
  const tools = createTools(definition.tools, workspace, dependencies.fanto);
  const { harness } = await AgentHarness.create<ExecutionToolContext>({
    session,
    models: dependencies.models,
    model,
    systemPrompt: (_toolContext, context) => resolveRunSystemPrompt(context, definition.systemPrompt),
    tools,
    activeToolNames: tools.map(tool => tool.name),
    toolContext: { env: new NodeExecutionEnv({ cwd: workspace, shellEnv: {} }) },
    resources: { skills: dependencies.skills.load(definition.skills) },
    compaction: definition.compaction,
    streamOptions: { timeoutMs: 120_000, maxRetries: 0 },
  }, TODO_CONTEXT);
  installWorkspacePolicy(harness, workspace);
  const lane = await harness.lane("main", { createAt: null }, TODO_CONTEXT);
  return { harness, lane };
}

function installWorkspacePolicy(harness: AgentHarness<ExecutionToolContext>, workspace: string): void {
  harness.hooks.on("before_tool", ({ toolName, args }) => {
    if (["read", "write", "edit"].includes(toolName) && args && typeof args === "object") {
      const path = (args as Record<string, unknown>).path;
      if (typeof path !== "string") return { block: { reason: "A file path is required", terminate: true } };
      try {
        assertWorkspacePath(workspace, path);
      } catch (cause) {
        return { block: { reason: cause instanceof Error ? cause.message : "Invalid workspace path", terminate: true } };
      }
    }
    if (toolName === "bash") {
      try {
        assertBashRequest(args);
      } catch (cause) {
        return { block: { reason: cause instanceof Error ? cause.message : "Invalid bash request", terminate: true } };
      }
    }
    return undefined;
  });
}
