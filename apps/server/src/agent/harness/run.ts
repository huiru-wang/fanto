import type { CreativeAuthority } from "../../creative-runtime/model.js";
import { isInternalAgent } from "../../creative-runtime/model.js";
import { randomUUID } from "node:crypto";
import { withAbortSignal } from "@earendil-works/pi-agent-core";
import { createRunContext } from "../context/index.js";
import { subscribeHarnessEvents, type AgentStreamEvent } from "./events.js";
import type { HarnessRuntime } from "./build-runtime.js";

export type RunSession = { id: string; userId: string; agentId?: string; runtime: HarnessRuntime };

export async function runAgent(
  session: RunSession,
  message: string,
  signal: AbortSignal,
  metadata: { creative?: CreativeAuthority; traceId?: string; timeZone?: string; task?: { taskId: string; taskRunId: string }; taskPlanReady?: boolean },
  emit: (event: AgentStreamEvent) => Promise<void>,
): Promise<string> {
  if (session.agentId && isInternalAgent(session.agentId) && (!metadata.creative || (session.agentId === "proposal-agent" ? metadata.creative.role !== "proposal" : metadata.creative.role !== "creator"))) throw new Error("CREATIVE_AUTHORITY_REQUIRED");
  let output = "";
  const abort = () => { void session.runtime.abort().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const context = withAbortSignal(signal, createRunContext({
      runId: randomUUID(), userId: session.userId, sessionId: session.id, query: message, slots: {},
      creative: metadata.creative, traceId: metadata.traceId, timeZone: metadata.timeZone, task: metadata.task, taskPlanReady: metadata.taskPlanReady, recentMessages: await session.runtime.readRecentMessages(),
    }));
    const data = createRunContext.read(context);
    const unsubscribe = subscribeHarnessEvents(session.runtime.harness, session.runtime.tools, data, message, emit, () => signal.aborted, text => { output += text; });
    try {
      const result = await session.runtime.prompt(message, context);
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
