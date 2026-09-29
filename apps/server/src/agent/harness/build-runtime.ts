import { AgentHarness, TODO_CONTEXT, type AgentLane, type Context, type ExecutionToolContext, type JsonValue, type Session } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { Models } from "@earendil-works/pi-ai";
import type { AgentDefinition } from "./definition.js";
import { createContextProviders, createSystemPrompt, createTransformContext } from "../context/index.js";
import type { ContextMessage } from "../context/run-context.js";
import type { AgentBusinessServices } from "../business-services.js";
import type { SkillLoader } from "../skills/loader.js";
import { createTools } from "../tools/index.js";
import { installHarnessHooks } from "./hooks.js";
import { messageText } from "./events.js";

export type HarnessRuntime = {
  harness: AgentHarness<ExecutionToolContext>;
  prompt(query: string, context: Context): ReturnType<AgentLane["prompt"]>;
  readRecentMessages(): Promise<ContextMessage[]>;
  appendCustomEntry(type: string, data: JsonValue | undefined): Promise<string>;
  abort(): Promise<void>;
  close(): Promise<void>;
};

export type HarnessDependencies = { models: Models; fanto: AgentBusinessServices; skills: SkillLoader };

export async function buildRuntime(session: Session, definition: AgentDefinition, workspace: string, dependencies: HarnessDependencies): Promise<HarnessRuntime> {
  const model = dependencies.models.getModel(definition.provider, definition.model);
  if (!model) throw new Error(`Unknown model: ${definition.provider}/${definition.model}`);
  const tools = createTools(definition.tools, workspace, dependencies.fanto);
  const systemPrompt = createSystemPrompt({
    template: definition.systemPrompt,
    providers: createContextProviders({ fanto: dependencies.fanto }),
  });
  const { harness } = await AgentHarness.create<ExecutionToolContext>({
    session, models: dependencies.models, model, systemPrompt: systemPrompt.resolve, tools, activeToolNames: tools.map(tool => tool.name),
    toolContext: { env: new NodeExecutionEnv({ cwd: workspace, shellEnv: {} }) }, resources: { skills: dependencies.skills.load(definition.skills) },
    compaction: definition.compaction, streamOptions: { timeoutMs: 120_000, maxRetries: 0 },
  }, TODO_CONTEXT);
  installHarnessHooks(harness, { workspace, systemPrompt, transformContext: createTransformContext() });
  const lane = await harness.lane("main", { createAt: null }, TODO_CONTEXT);
  await lane.setModel({ provider: definition.provider, modelId: definition.model }, TODO_CONTEXT);
  await lane.setActiveTools(definition.tools, TODO_CONTEXT);
  return {
    harness,
    prompt: (query, context) => lane.prompt(query, undefined, context),
    async readRecentMessages() {
      const entries = await lane.findEntries({ type: "message", order: "newestFirst", limit: 12 }, TODO_CONTEXT);
      return entries.reverse().flatMap(entry => {
        if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) return [];
        const text = messageText(entry.message).trim();
        return text ? [{ role: entry.message.role, text } as ContextMessage] : [];
      }).slice(-8);
    },
    appendCustomEntry: (type, data) => lane.appendCustomEntry(type, data, TODO_CONTEXT),
    async abort() { await lane.abort(TODO_CONTEXT); },
    close: () => harness.close(TODO_CONTEXT),
  };
}
