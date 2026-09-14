import { AgentHarness, type AgentHarnessTool, TODO_CONTEXT, type AgentLane, type ExecutionToolContext, type Session } from "@earendil-works/pi-agent-core";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Models } from "@earendil-works/pi-ai";
import type { AgentDefinition } from "../config/agent-config.js";
import { assertWorkspacePath } from "./workspace.js";
import { assertBashRequest } from "../security/sandbox-policy.js";
import { LocalSandboxAdapter, type SandboxAdapter } from "../security/sandbox.js";
import { SkillLoader } from "../skills/loader.js";
import { ToolRegistry } from "../tools/registry.js";

export type HarnessRuntime = {
  harness: AgentHarness<ExecutionToolContext>;
  lane: AgentLane;
};

export class HarnessFactory {
  readonly models: Models = builtinModels();

  constructor(private readonly tools: ToolRegistry, private readonly skills: SkillLoader, private readonly sandbox: SandboxAdapter = new LocalSandboxAdapter()) {}

  async create(session: Session, definition: AgentDefinition, workspace: string): Promise<HarnessRuntime> {
    const model = this.models.getModel(definition.provider, definition.model);
    if (!model) throw new Error(`Unknown model: ${definition.provider}/${definition.model}`);
    const tools = this.tools.create(definition.tools, workspace);
    const { harness } = await AgentHarness.create<ExecutionToolContext>({
      session,
      models: this.models,
      model,
      systemPrompt: definition.systemPrompt,
      tools,
      activeToolNames: tools.map(tool => tool.name),
      toolContext: { env: this.sandbox.createExecutionEnv(workspace) },
      resources: { skills: this.skills.load(definition.skills) },
      compaction: definition.compaction,
      streamOptions: { timeoutMs: 120_000, maxRetries: 0 },
    }, TODO_CONTEXT);
    this.installWorkspacePolicy(harness, workspace);
    const lane = await harness.lane("main", { createAt: null }, TODO_CONTEXT);
    return { harness, lane };
  }

  private installWorkspacePolicy(harness: AgentHarness<ExecutionToolContext>, workspace: string): void {
    harness.hooks.on("before_tool", ({ toolName, args }) => {
      if (["read", "write", "edit"].includes(toolName) && args && typeof args === "object") {
        const path = (args as Record<string, unknown>).path;
        if (typeof path !== "string") return { block: { reason: "A file path is required", terminate: true } };
        try { assertWorkspacePath(workspace, path); }
        catch (cause) { return { block: { reason: cause instanceof Error ? cause.message : "Invalid workspace path", terminate: true } }; }
      }
      if (toolName === "bash") {
        try { assertBashRequest(args); }
        catch (cause) { return { block: { reason: cause instanceof Error ? cause.message : "Invalid bash request", terminate: true } }; }
      }
      return undefined;
    });
  }
}
