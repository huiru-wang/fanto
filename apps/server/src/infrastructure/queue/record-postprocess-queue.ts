import { EventEmitter } from "node:events";
import { logError } from "../logging/logger.js";

export type RecordPostprocessTask = { recordId: string; userId: string; version: number };

export class RecordPostprocessQueue {
  private events = new EventEmitter();
  publish(task: RecordPostprocessTask) { queueMicrotask(() => this.events.emit("record", task)); }
  on(listener: (task: RecordPostprocessTask) => Promise<void>) {
    this.events.on("record", (task: RecordPostprocessTask) => void listener(task).catch(error => logError("record-postprocess", "Record postprocess failed", { error: error instanceof Error ? error.message : String(error), recordId: task.recordId })));
  }
}
