import { AgentHarness, TODO_CONTEXT, withoutAbortSignal, type AgentLane, type Context, type ExecutionToolContext, type JsonValue, type Session } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { Models } from "@earendil-works/pi-ai";
import type { AgentDefinition } from "./definition.js";
import type { TaskAgentCatalogEntry } from "./registry.js";
import { createContextProviders, createSystemPrompt, createTransformContext } from "../context/index.js";
import type { ContextMessage } from "../context/run-context.js";
import type { AgentBusinessServices } from "../business-services.js";
import type { SkillLoader } from "../skills/loader.js";
import { createTools } from "../tools/index.js";
import type { FantoTool } from "../tools/types.js";
import { installHarnessHooks } from "./hooks.js";
import { messageText } from "./events.js";
import { createRunContext } from "../context/run-context.js";
import { logRunEvent } from "./run-logging.js";

export type HarnessRuntime = {
  harness: AgentHarness<ExecutionToolContext>;
  tools: FantoTool[];
  prompt(query: string, context: Context): ReturnType<AgentLane["prompt"]>;
  readRecentMessages(): Promise<ContextMessage[]>;
  appendCustomEntry(type: string, data: JsonValue | undefined): Promise<string>;
  abort(): Promise<void>;
  close(): Promise<void>;
};

export type HarnessDependencies = {
  models: Models;
  fanto: AgentBusinessServices;
  skills: SkillLoader;
  taskAgents: readonly TaskAgentCatalogEntry[];
};

export async function buildRuntime(session: Session, definition: AgentDefinition, workspace: string, dependencies: HarnessDependencies): Promise<HarnessRuntime> {
  const model = dependencies.models.getModel(definition.provider, definition.model);
  if (!model) throw new Error("Unknown model: " + definition.provider + "/" + definition.model);
  const loadedSkills = dependencies.skills.load(definition.skills);
  const tools = createTools(definition.tools, workspace, dependencies.fanto, dependencies.taskAgents, dependencies.skills, definition.skills);
  const skillIndex = formatSkillIndex(loadedSkills);
  const systemPrompt = createSystemPrompt({
    template: definition.systemPrompt + (skillIndex ? "\n\n" + skillIndex : ""),
    providers: createContextProviders({ fanto: dependencies.fanto }),
  });
  const { harness } = await AgentHarness.create<ExecutionToolContext>({
    session, models: dependencies.models, model, systemPrompt: systemPrompt.resolve, tools, activeToolNames: tools.map(tool => tool.name),
    toolContext: { env: new NodeExecutionEnv({ cwd: workspace, shellEnv: {} }) }, resources: { skills: loadedSkills },
    compaction: definition.compaction, streamOptions: { timeoutMs: 120_000, maxRetries: 0 },
  }, TODO_CONTEXT);
  installHarnessHooks(harness, { workspace, systemPrompt, transformContext: createTransformContext() });
  const lane = await harness.lane("main", { createAt: null }, TODO_CONTEXT);
  await lane.setModel({ provider: definition.provider, modelId: definition.model }, TODO_CONTEXT);
  await lane.setActiveTools(definition.tools, TODO_CONTEXT);
  let activeContext: Context | undefined;
  return {
    harness,
    tools,
    async prompt(query, context) {
      activeContext=context;
      try {
        await clearInterruptedOperation(lane, context);
        return await lane.prompt(query, undefined, context);
      } finally { activeContext=undefined; }
    },
    async readRecentMessages() {
      const entries = await lane.findEntries({ type: "message", order: "newestFirst", limit: 12 }, TODO_CONTEXT);
      return entries.reverse().flatMap(entry => {
        if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) return [];
        const text = messageText(entry.message).trim();
        return text ? [{ role: entry.message.role, text } as ContextMessage] : [];
      }).slice(-8);
    },
    appendCustomEntry: (type, data) => lane.appendCustomEntry(type, data, TODO_CONTEXT),
    async abort() {
      await cancelLaneOperation(lane, activeContext ?? TODO_CONTEXT);
    },
    close: () => harness.close(TODO_CONTEXT),
  };
}

function formatSkillIndex(skills: readonly { name: string; description: string; filePath: string; disableModelInvocation?: boolean }[]): string {
  const visible = skills.filter(skill => !skill.disableModelInvocation);
  if (!visible.length) return "";
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const lines = [
    "The following skills provide specialized instructions for specific tasks.",
    "When a task matches a skill, read its full SKILL.md with skill_read before applying it unless the server explicitly invoked that skill.",
    "<available_skills>",
  ];
  for (const skill of visible) {
    lines.push("  <skill>");
    lines.push("    <name>" + escape(skill.name) + "</name>");
    lines.push("    <description>" + escape(skill.description) + "</description>");
    lines.push("    <location>" + escape(skill.filePath) + "</location>");
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

/** Called only after the application reserves this Session for a new turn. */
export async function clearInterruptedOperation(lane: AgentLane, context: Context): Promise<void> {
  const execution = await lane.inspectExecution(TODO_CONTEXT);
  if (!execution.current) return;
  logRunEvent(createRunContext.read(context), "interrupted operation cleanup started", {operationId: execution.current.id});
  await cancelLaneOperation(lane, context);
  await lane.appendCustomEntry("fanto.run_stopped", {operationId:execution.current.id}, TODO_CONTEXT);
  logRunEvent(createRunContext.read(context), "interrupted operation cleanup completed", {operationId: execution.current.id});
}

/** Keep Run Context values while allowing cancellation to finish durable reconciliation. */
export async function cancelLaneOperation(lane: AgentLane, context: Context): Promise<void> {
  const cleanupContext = withoutAbortSignal(context);
  const result = await lane.abort(cleanupContext);
  if (!result.ok && result.error._tag !== "NoActiveOperation") throw new Error(`AGENT_ABORT_REJECTED:${result.error._tag}`);
  await lane.waitForIdle(cleanupContext);
}
