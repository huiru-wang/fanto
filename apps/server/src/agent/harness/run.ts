import { waitForOutput } from "./run-output.js";
import { logSummary, logWarn } from "../../infrastructure/logging/logger.js";
import { logRunEvent, startRunLogging } from "./run-logging.js";
import { randomUUID } from "node:crypto";
import { withAbortSignal, type Context } from "@earendil-works/pi-agent-core";
import { createRunContext } from "../context/index.js";
import { subscribeHarnessEvents, type AgentStreamEvent } from "./events.js";
import type { StopState } from "./stop-state.js";
import type { RunData } from "../context/run-context.js";
import type { Entry } from "@earendil-works/pi-agent-core";
import type { HarnessRuntime } from "./build-runtime.js";

export type RunSession = { id: string; userId: string; agentId?: string; runtime: HarnessRuntime; checkpoint?: { beginRun(id: string): void; endRun(): void; flush(): Promise<void> } };
export type RunMetadata = { traceId?: string; timeZone?: string; };

type ActiveRun = {controller: AbortController; settled: Promise<void>; finish: () => void; error?: unknown; stop: StopState; data?: RunData};
const activeRuns = new Map<string, ActiveRun>();

/** Accept stop immediately. In-flight tools finish, but no new work may start. */
export function requestAgentStop(sessionId: string): { accepted: boolean; stopping: boolean; waitingForTools: boolean } {
  const active = activeRuns.get(sessionId);
  if (!active) return { accepted: false, stopping: false, waitingForTools: false };
  active.stop.requested = true;
  if (active.stop.tools === 0) active.controller.abort(new DOMException("user_stop", "AbortError"));
  return { accepted: true, stopping: true, waitingForTools: active.stop.tools > 0 };
}
export function isAgentStopping(sessionId: string): boolean { return activeRuns.get(sessionId)?.stop.requested ?? false; }
export function liveAssistantEntry(sessionId: string): Entry | undefined { return activeRuns.get(sessionId)?.data?.liveAssistant; }

/** Internal callers may wait for in-memory completion; HTTP stop never waits on a tool. */
export async function stopAgentRun(sessionId: string): Promise<boolean> {
  const active = activeRuns.get(sessionId);
  if (!active) return false;
  requestAgentStop(sessionId);
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
  const active: ActiveRun = {stop: { requested: false, tools: 0 }, controller, settled: new Promise<void>(resolve => {finish=resolve;}), finish: () => finish()};
  activeRuns.set(session.id, active);
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, {once:true});
  if (signal.aborted) onAbort();
  try {
    let disconnected = false;
    const deliver = async (write: () => Promise<void>) => {
      if (disconnected) return;
      try {
        const status = await waitForOutput(write, controller.signal);
        if (status === "timeout") {
          logWarn("agent-run", "output wait timed out", {sessionId:session.id,agentId:session.agentId,traceId:metadata.traceId});
          disconnected = true;
        }
      } catch (error) {
        logWarn("agent-run", "output disconnected", {sessionId:session.id,agentId:session.agentId,traceId:metadata.traceId,error:logSummary(error)});
        disconnected = true;
      }
    };
    return await run(session, message, controller.signal, metadata, event => deliver(() => emit(event)),
      context => session.runtime.prompt(message, context), onStarted ? () => deliver(onStarted) : undefined, active);
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
  onStarted: (() => Promise<void>) | undefined,
  active: ActiveRun,
): Promise<string> {
  let output = "";
  const startedAt=Date.now();
  const context = withAbortSignal(signal, createRunContext({
    runId:randomUUID(),userId:session.userId,sessionId:session.id,agentId:session.agentId,query,slots:{},recentMessages:[],
    traceId:metadata.traceId,timeZone:metadata.timeZone,stop:active.stop,
  }));
  const data=createRunContext.read(context);
  active.data = data;
  // Do not start the next Pi Run on top of any uncommitted previous history.
  await session.checkpoint?.flush();
  session.checkpoint?.beginRun(data.runId);
  const stopLogging=startRunLogging(data);
  let abortPromise: Promise<void> | undefined;
  const abort = () => {
    abortPromise ??= session.runtime.abort();
    void abortPromise.catch(error => {logRunEvent(data,"abort failed",{error:logSummary(error)},"error");});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    await onStarted?.();
    signal.throwIfAborted();
    logRunEvent(data,"history read started");
    data.recentMessages=await session.runtime.readRecentMessages();
    logRunEvent(data,"history read completed");
    signal.throwIfAborted();
    const unsubscribe = subscribeHarnessEvents(session.runtime.harness, session.runtime.tools, data, query, emit, () => signal.aborted, text => { output += text; });
    try {
      const result = await invoke(context);
      signal.throwIfAborted();
      if (active.stop.requested) throw new DOMException("user_stop", "AbortError");
      if (!result.ok) throw new Error(`AGENT_RUN_REJECTED:${result.error._tag}`);
      if (result.value.status !== "completed") throw new Error(`AGENT_RUN_NOT_COMPLETED:${result.value.status}`);
      logRunEvent(data,"completed",{durationMs:Date.now()-startedAt});
      return output;
    } finally {
      unsubscribe();
    }
  } catch(error) {
    logRunEvent(data,(signal.aborted || active.stop.requested)?"aborted":"failed",{error:logSummary(error),durationMs:Date.now()-startedAt},"error");
    throw error;
  } finally {
    // Wait for SDK memory reconciliation, never for database history persistence.
    try {
      await abortPromise;
      if ((signal.aborted || active.stop.requested) && data.sourceMessageId) {
        await session.runtime.appendCustomEntry("fanto.run_stopped", {runId:data.runId,sourceMessageId:data.sourceMessageId});
        logRunEvent(data,"stop recorded in memory",{sourceMessageId:data.sourceMessageId});
      }
      await session.checkpoint?.flush();
    }
    finally {
      session.checkpoint?.endRun();
      stopLogging();
      signal.removeEventListener("abort", abort);
    }
  }
}
