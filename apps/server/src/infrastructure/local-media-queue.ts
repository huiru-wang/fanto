import { EventEmitter } from "node:events";
import { logError } from "./logger.js";

export type ImageUnderstandingTask = { recordId: string; userId: string; mediaId: string; version: number };

export class LocalMediaQueue {
  private events = new EventEmitter();
  publish(type: "image_understanding", task: ImageUnderstandingTask) { queueMicrotask(() => this.events.emit(type, task)); }
  on(type: "image_understanding", listener: (task: ImageUnderstandingTask) => Promise<void>) {
    this.events.on(type, (task: ImageUnderstandingTask) => void listener(task).catch(error => logError("image-understanding", "Image understanding failed", { error: error instanceof Error ? error.message : String(error), mediaId: task.mediaId, recordId: task.recordId })));
  }
}
