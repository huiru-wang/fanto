import { randomUUID } from "node:crypto";
import { withAbortSignal, type Context } from "@earendil-works/pi-agent-core";
import { createRunContext } from "../context/index.js";
import { subscribeHarnessEvents, type AgentStreamEvent } from "./events.js";
import type { HarnessRuntime } from "./build-runtime.js";

export type RunSession = { id: string; userId: string; agentId?: string; runtime: HarnessRuntime };
export type RunMetadata = { projectId?: string; recordId?: string; recordVersion?: number; traceId?: string; timeZone?: string; task?: { taskId: string; taskRunId: string } };

export function runAgent(
  session: RunSession,
  message: string,
  signal: AbortSignal,
  metadata: RunMetadata,
  emit: (event: AgentStreamEvent) => Promise<void>,
): Promise<string> {
  return run(session, message, signal, metadata, emit, context => session.runtime.prompt(message, context));
}

async function run(
  session: RunSession,
  query: string,
  signal: AbortSignal,
  metadata: RunMetadata,
  emit: (event: AgentStreamEvent) => Promise<void>,
  invoke: (context: Context) => ReturnType<HarnessRuntime["prompt"]>,
): Promise<string> {
  let output = "";
  const abort = () => { void session.runtime.abort().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const context = withAbortSignal(signal, createRunContext({
      runId: randomUUID(), userId: session.userId, sessionId: session.id, query, slots: {},
      projectId: metadata.projectId, recordId: metadata.recordId, recordVersion: metadata.recordVersion, traceId: metadata.traceId, timeZone: metadata.timeZone, task: metadata.task, recentMessages: await session.runtime.readRecentMessages(),
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
