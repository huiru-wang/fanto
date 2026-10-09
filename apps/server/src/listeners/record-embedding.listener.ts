import type { RecordEmbeddingQueue } from "../event/record-embedding-queue.js";
import type { RecordRetrievalService, RecordService } from "../domain/records/index.js";
export function registerRecordEmbeddingListener(queue:RecordEmbeddingQueue, records:RecordService,
  retrieval:Pick<RecordRetrievalService,"replaceRecord">) {
  return queue.on(async task => {
    const [record]=await records.findMany(task.userId,[task.recordId]);
    if(!record || record.version!==task.version || record.status!=="processed")return;
    await retrieval.replaceRecord({...record,taskId:null});
  });
}
