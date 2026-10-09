import { EventEmitter } from "node:events";
import { logError } from "../infrastructure/logging/logger.js";
export type AgentExecutionMessage =
  | {type:"proposal"; userId:string; recordId:string; version:number}
  | {type:"creator"; userId:string; proposalId:string; projectId:string}
  | {type:"task"; userId:string; taskId:string; taskRunId:string};
export class AgentExecutionQueue {
  private readonly events = new EventEmitter();
  publish(task: AgentExecutionMessage) { queueMicrotask(() => this.events.emit("task", task)); }
  on(listener: (task: AgentExecutionMessage) => Promise<void>) {
    const handler = (task: AgentExecutionMessage) => void listener(task).catch(error =>
      logError("agent-execution", "Unhandled listener error", {type:task.type, error:String(error)}));
    this.events.on("task", handler);
    return () => this.events.off("task", handler);
  }
}
