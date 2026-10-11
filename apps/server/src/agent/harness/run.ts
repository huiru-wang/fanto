import { logSummary } from "../../infrastructure/logging/logger.js";
import { logRunEvent, startRunLogging } from "./run-logging.js";
import { randomUUID } from "node:crypto";
import { withAbortSignal, type Context } from "@earendil-works/pi-agent-core";
import { createRunContext } from "../context/index.js";
import { subscribeHarnessEvents, type AgentStreamEvent } from "./events.js";
import type { HarnessRuntime } from "./build-runtime.js";

export type RunSession = { id: string; userId: string; agentId?: string; runtime: HarnessRuntime };
export type RunMetadata = { proposalId?: string; projectId?: string; recordId?: string; recordVersion?: number; traceId?: string; timeZone?: string; task?: { taskId: string; taskRunId: string } };

type ActiveRun = {controller: AbortController; settled: Promise<void>; finish: () => void; error?: unknown};
const activeRuns = new Map<string, ActiveRun>();

/** Stop the current turn and wait for durable cancellation; never start or replay a run. */
export async function stopAgentRun(sessionId: string): Promise<boolean> {
  const active = activeRuns.get(sessionId);
  if (!active) return false;
  active.controller.abort();
  await active.settled;
  if (active.error) throw active.error;
  return true;
}

export async function runAgent(
  session: RunSession,
  message: string,
  signal: AbortSignal,
  metadata: RunMetadata,
  emit: (event: AgentStreamEvent) => Promise<void>,
  onStarted?: () => Promise<void>,
): Promise<string> {
  if (activeRuns.has(session.id)) throw new Error("AGENT_RUN_REJECTED:LaneBusy");
  const controller = new AbortController();
  let finish!: () => void;
  const active: ActiveRun = {controller, settled: new Promise<void>(resolve => {finish=resolve;}), finish: () => finish()};
  activeRuns.set(session.id, active);
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, {once:true});
  if (signal.aborted) onAbort();
  try {
    await onStarted?.();
    return await run(session, message, controller.signal, metadata, emit, context => session.runtime.prompt(message, context));
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof Error && error.name === "AbortError")) active.error=error;
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    activeRuns.delete(session.id);
    active.finish();
  }
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
  const startedAt=Date.now();
  const context = withAbortSignal(signal, createRunContext({
    runId:randomUUID(),userId:session.userId,sessionId:session.id,agentId:session.agentId,query,slots:{},recentMessages:[],
    proposalId:metadata.proposalId,projectId:metadata.projectId,recordId:metadata.recordId,recordVersion:metadata.recordVersion,
    traceId:metadata.traceId,timeZone:metadata.timeZone,task:metadata.task,
  }));
  const data=createRunContext.read(context);
  const stopLogging=startRunLogging(data);
  let abortPromise: Promise<void> | undefined;
  const abort = () => {
    abortPromise ??= session.runtime.abort();
    void abortPromise.catch(error => {logRunEvent(data,"abort failed",{error:logSummary(error)},"error");});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    logRunEvent(data,"history read started");
    data.recentMessages=await session.runtime.readRecentMessages();
    logRunEvent(data,"history read completed");
    const unsubscribe = subscribeHarnessEvents(session.runtime.harness, session.runtime.tools, data, query, emit, () => signal.aborted, text => { output += text; });
    try {
      const result = await invoke(context);
      signal.throwIfAborted();
      if (!result.ok) throw new Error(`AGENT_RUN_REJECTED:${result.error._tag}`);
      if (result.value.status !== "completed") throw new Error(`AGENT_RUN_NOT_COMPLETED:${result.value.status}`);
      logRunEvent(data,"completed",{durationMs:Date.now()-startedAt});
      return output;
    } finally {
      unsubscribe();
    }
  } catch(error) {
    logRunEvent(data,signal.aborted?"aborted":"failed",{error:logSummary(error),durationMs:Date.now()-startedAt},"error");
    throw error;
  } finally {
    // Durable cancellation must settle before the caller releases/closes this Session.
    // Otherwise close can race the abort commit and leave the lane occupied.
    try {
      await abortPromise;
      if (signal.aborted && data.sourceMessageId) {
        await session.runtime.appendCustomEntry("fanto.run_stopped", {runId:data.runId,sourceMessageId:data.sourceMessageId});
        logRunEvent(data,"stop persisted",{sourceMessageId:data.sourceMessageId});
      }
    }
    finally {
      stopLogging();
      signal.removeEventListener("abort", abort);
    }
  }
}
