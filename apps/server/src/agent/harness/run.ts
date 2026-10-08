import type { CreativeAuthority } from "../../creative-runtime/model.js";
import { isInternalAgent } from "../../creative-runtime/model.js";
import { randomUUID } from "node:crypto";
import { withAbortSignal, type Context } from "@earendil-works/pi-agent-core";
import { createRunContext } from "../context/index.js";
import { subscribeHarnessEvents, type AgentStreamEvent } from "./events.js";
import type { HarnessRuntime } from "./build-runtime.js";

export type RunSession = { id: string; userId: string; agentId?: string; runtime: HarnessRuntime };
type RunMetadata = { creative?: CreativeAuthority; traceId?: string; timeZone?: string; task?: { taskId: string; taskRunId: string }; taskPlanReady?: boolean };

export function runAgent(
  session: RunSession,
  message: string,
  signal: AbortSignal,
  metadata: RunMetadata,
  emit: (event: AgentStreamEvent) => Promise<void>,
): Promise<string> {
  return run(session, message, signal, metadata, emit, context => session.runtime.prompt(message, context));
}

export function runAgentSkill(
  session: RunSession,
  skillName: string,
  instructions: string,
  signal: AbortSignal,
  metadata: RunMetadata,
  emit: (event: AgentStreamEvent) => Promise<void>,
): Promise<string> {
  return run(session, instructions, signal, metadata, emit, context => session.runtime.skill(skillName, instructions, context));
}

async function run(
  session: RunSession,
  query: string,
  signal: AbortSignal,
  metadata: RunMetadata,
  emit: (event: AgentStreamEvent) => Promise<void>,
  invoke: (context: Context) => ReturnType<HarnessRuntime["prompt"]>,
): Promise<string> {
  if (session.agentId && isInternalAgent(session.agentId) && (!metadata.creative || (session.agentId === "proposal-agent" ? metadata.creative.role !== "proposal" : metadata.creative.role !== "creator"))) throw new Error("CREATIVE_AUTHORITY_REQUIRED");
  let output = "";
  const abort = () => { void session.runtime.abort().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const context = withAbortSignal(signal, createRunContext({
      runId: randomUUID(), userId: session.userId, sessionId: session.id, query, slots: {},
      creative: metadata.creative, traceId: metadata.traceId, timeZone: metadata.timeZone, task: metadata.task, taskPlanReady: metadata.taskPlanReady, recentMessages: await session.runtime.readRecentMessages(),
    }));
    const data = createRunContext.read(context);
    const unsubscribe = subscribeHarnessEvents(session.runtime.harness, session.runtime.tools, data, query, emit, () => signal.aborted, text => { output += text; });
    try {
      const result = await invoke(context);
      signal.throwIfAborted();
      if (!result.ok || result.value.status !== "completed") throw new Error("Agent run did not complete");
      return output;
    } finally {
      unsubscribe();
    }
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
