import type { RecordMemoryService } from "../application/memory/record-memory.js";
import type { LocalVectorQueue } from "../infrastructure/local-vector-queue.js";

export function registerRecordVectorListener(queue: LocalVectorQueue, memory: RecordMemoryService) {
  queue.on(task => memory.index(task));
}
