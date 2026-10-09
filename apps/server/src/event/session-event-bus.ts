import type { AgentStreamEvent } from "../agent/harness/events.js";
export type SessionEvent = AgentStreamEvent | {type:"start"; agentId:string} | {type:"done"} | {type:"error"; message?:string};
export class SessionEventBus {
  private readonly listeners = new Map<string, Set<(event:SessionEvent)=>void>>();
  publish(sessionId:string, event:SessionEvent) {
    for(const listener of this.listeners.get(sessionId)??[]) {
      try {listener(event);}catch { /* one disconnected subscriber cannot interrupt Agent */ }
    }
  }
  subscribe(sessionId:string, listener:(event:SessionEvent)=>void) {
    let subscribers=this.listeners.get(sessionId);
    if(!subscribers){subscribers=new Set();this.listeners.set(sessionId,subscribers);}
    subscribers.add(listener);
    return ()=>{subscribers!.delete(listener);if(!subscribers!.size)this.listeners.delete(sessionId);};
  }
}
