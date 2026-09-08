import { EventEmitter } from "node:events";

export type ImageUnderstandingTask = { recordId: string; userId: string; mediaId: string; version: number };

export class LocalMediaQueue {
  private events = new EventEmitter();
  publish(type: "image_understanding", task: ImageUnderstandingTask) { queueMicrotask(() => this.events.emit(type, task)); }
  on(type: "image_understanding", listener: (task: ImageUnderstandingTask) => Promise<void>) {
    this.events.on(type, (task: ImageUnderstandingTask) => void listener(task).catch(error => console.error("[image-understanding]", error)));
  }
}
