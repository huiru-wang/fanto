import type { RunData } from "../context/run-context.js";
import { logError, logInfo, logWarn } from "../../infrastructure/logging/logger.js";

const progress = new WeakMap<RunData, { startedAt: number; lastActivityAt: number; phase: string; tools: Map<string, {name: string; startedAt: number}> }>();
export const runLogDetails = (data: RunData) => ({
  userId:data.userId, agentId:data.agentId, sessionId:data.sessionId, runId:data.runId,
  recordId:data.recordId, version:data.recordVersion, proposalId:data.proposalId,
  projectId:data.projectId, traceId:data.traceId, taskId:data.task?.taskId, taskRunId:data.task?.taskRunId,
});

export function logRunEvent(data: RunData, event: string, details: Record<string,unknown> = {}, level: "info" | "warn" | "error" = "info") {
  const state=progress.get(data);
  if(state){state.lastActivityAt=Date.now();state.phase=event;}
  const write=level==="error"?logError:level==="warn"?logWarn:logInfo;
  write("agent-run",event,{...runLogDetails(data),...details});
}

/** Streaming activity updates the watchdog without logging text or every delta. */
export function touchRun(data: RunData) {
  const state=progress.get(data);
  if(state)state.lastActivityAt=Date.now();
}

export function trackTool(data: RunData, id: string, name: string, started: boolean): number | undefined {
  const state=progress.get(data);
  if(!state)return;
  if(started){state.tools.set(id,{name,startedAt:Date.now()});return;}
  const prior=state.tools.get(id);
  state.tools.delete(id);
  return prior?Date.now()-prior.startedAt:undefined;
}

export function startRunLogging(data: RunData) {
  const startedAt=Date.now();
  const state={startedAt,lastActivityAt:startedAt,phase:"initializing",tools:new Map<string,{name:string;startedAt:number}>()};
  progress.set(data,state);
  logRunEvent(data,"started");
  const timer=setInterval(()=>{
    const now=Date.now();
    if(now-state.lastActivityAt<60_000)return;
    logWarn("agent-run","waiting",{...runLogDetails(data),phase:state.phase,
      idleMs:now-state.lastActivityAt,durationMs:now-startedAt,
      activeTools:[...state.tools].map(([toolCallId,tool])=>({toolCallId,toolName:tool.name,durationMs:now-tool.startedAt}))});
  },60_000);
  timer.unref();
  return ()=>{clearInterval(timer);progress.delete(data);};
}
