import { EventEmitter } from "node:events";
import { logError } from "./logger.js";

export type RecordVectorTask = { userId: string; recordId: string; operation: "upsert" | "replace" };

export class LocalVectorQueue {
  private events = new EventEmitter();
  publish(task: RecordVectorTask) { queueMicrotask(() => this.events.emit("record", task)); }
  on(listener: (task: RecordVectorTask) => Promise<void>) {
    this.events.on("record", (task: RecordVectorTask) => void listener(task).catch(error => logError("record-vector", "Vector indexing failed", { error: error instanceof Error ? error.message : String(error), recordId: task.recordId })));
  }
}
