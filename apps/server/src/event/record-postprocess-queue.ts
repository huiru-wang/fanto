import { EventEmitter } from "node:events";
import { logError } from "../infrastructure/logging/logger.js";
export type RecordPostprocessTask = {recordId: string; userId: string; version: number};
export class RecordPostprocessQueue {
  private readonly events = new EventEmitter();
  publish(task: RecordPostprocessTask) { queueMicrotask(() => this.events.emit("task", task)); }
  on(listener: (task: RecordPostprocessTask) => Promise<void>) {
    const handler = (task: RecordPostprocessTask) => void listener(task).catch(error =>
      logError("record-postprocess", "Listener failed", {recordId: task.recordId, error: String(error)}));
    this.events.on("task", handler);
    return () => this.events.off("task", handler);
  }
}
