import { EventEmitter } from "node:events";
import { logError } from "../infrastructure/logging/logger.js";
export type RecordEmbeddingTask = {recordId: string; userId: string; version: number};
export class RecordEmbeddingQueue {
  private readonly events = new EventEmitter();
  publish(task: RecordEmbeddingTask) { queueMicrotask(() => this.events.emit("task", task)); }
  on(listener: (task: RecordEmbeddingTask) => Promise<void>) {
    const handler = (task: RecordEmbeddingTask) => void listener(task).catch(error =>
      logError("record-embedding", "Embedding failed", {recordId: task.recordId, error: String(error)}));
    this.events.on("task", handler);
    return () => this.events.off("task", handler);
  }
}
