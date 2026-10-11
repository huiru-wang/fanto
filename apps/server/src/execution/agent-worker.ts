import { logInfo, logWarn, logError, logSummary } from "../infrastructure/logging/logger.js";
import { runAgent } from "../agent/harness/run.js";
import type { AgentSessionManager, ManagedSession } from "../agent/harness/session-manager.js";
import type { AgentStreamEvent } from "../agent/harness/events.js";
import type { SessionEventBus } from "../event/session-event-bus.js";

type Metadata = Parameters<typeof runAgent>[3];

export class AgentWorker {
  constructor(private readonly sessions: AgentSessionManager, readonly events: SessionEventBus) {}
  async run(session: ManagedSession, message: string, timeoutMs: number, metadata: Metadata,
    publishEvents = false, externalSignal?: AbortSignal,
    onCompleted?: () => Promise<void>, publishTerminalEvents = true): Promise<string> {
    const details={userId:session.userId,sessionId:session.id,agentId:session.agentId,
      recordId:metadata.recordId,version:metadata.recordVersion,proposalId:metadata.proposalId,projectId:metadata.projectId};
    let stage="reserve_session";
    logInfo("agent-execution","worker started",{...details,timeoutMs});
    let release: (()=>void);
    try { release = this.sessions.reserve(session); }
    catch(error) {
      logError("agent-execution","worker failed",{...details,stage,error:logSummary(error)});
      // The shared session may still be owned by a competing user turn.
      // Do not close a busy session; its current owner will release it.
      throw error;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onAbort, {once:true});
    if (externalSignal?.aborted) onAbort();
    const timeout = setTimeout(() => {
      logWarn("agent-execution", "timed out", {userId:session.userId,sessionId:session.id,agentId:session.agentId,
        recordId:metadata.recordId,version:metadata.recordVersion,proposalId:metadata.proposalId,projectId:metadata.projectId,stage,timeoutMs});
      controller.abort();
    }, timeoutMs);
    if (publishEvents) this.events.publish(session.id, {type:"start",agentId:session.agentId});
    try {
      stage="agent_run";
      const output=await runAgent(session,message,controller.signal,metadata,async (event:AgentStreamEvent)=>{
        if(publishEvents)this.events.publish(session.id,event);
      });
      stage="validate_result";
      await onCompleted?.();
      if(publishEvents && publishTerminalEvents)this.events.publish(session.id,{type:"done"});
      return output;
    } catch(error) {
      logError("agent-execution","worker failed",{...details,stage,error:logSummary(error)});
      if(publishEvents && publishTerminalEvents)this.events.publish(session.id,error instanceof Error && error.name === "AbortError" ? {type:"stopped"} : {type:"error",message:error instanceof Error?error.message:String(error)});
      throw error;
    } finally {
      clearTimeout(timeout);externalSignal?.removeEventListener("abort",onAbort);
      logInfo("agent-execution","session release started",details);
      try {
        await this.sessions.release(session.id, true);
        logInfo("agent-execution","session released",details);
      } catch(error) {
        logError("agent-execution","session release failed",{...details,error:logSummary(error)});
        throw error;
      } finally { release(); }
    }
  }
}
