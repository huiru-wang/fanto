import type { RecordMemoryService } from "../domain/memory/record-index.js";
import type { LocalVectorQueue } from "../infrastructure/queue/vector-queue.js";

export function registerRecordVectorListener(queue: LocalVectorQueue, memory: RecordMemoryService) {
  queue.on(task => memory.index(task));
}
