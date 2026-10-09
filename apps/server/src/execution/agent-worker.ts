import { runAgent } from "../agent/harness/run.js";
import type { AgentSessionManager, ManagedSession } from "../agent/harness/session-manager.js";
import type { AgentStreamEvent } from "../agent/harness/events.js";
import type { SessionEventBus } from "../event/session-event-bus.js";

type Metadata = Parameters<typeof runAgent>[3];

export class AgentWorker {
  constructor(private readonly sessions: AgentSessionManager, readonly events: SessionEventBus) {}
  async run(session: ManagedSession, message: string, timeoutMs: number, metadata: Metadata,
    publishEvents = false, externalSignal?: AbortSignal,
    onCompleted?: () => Promise<void>): Promise<string> {
    let release: (()=>void);
    try { release = this.sessions.reserve(session); }
    catch(error) {
      // The shared session may still be owned by a competing user turn.
      // Do not close a busy session; its current owner will release it.
      throw error;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onAbort, {once:true});
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (publishEvents) this.events.publish(session.id, {type:"start",agentId:session.agentId});
    try {
      const output=await runAgent(session,message,controller.signal,metadata,async (event:AgentStreamEvent)=>{
        if(publishEvents)this.events.publish(session.id,event);
      });
      await onCompleted?.();
      if(publishEvents)this.events.publish(session.id,{type:"done"});
      return output;
    } catch(error) {
      if(publishEvents)this.events.publish(session.id,{type:"error",message:error instanceof Error?error.message:String(error)});
      throw error;
    } finally {
      clearTimeout(timeout);externalSignal?.removeEventListener("abort",onAbort);
      release();
      await this.sessions.release(session.id);
    }
  }
}
