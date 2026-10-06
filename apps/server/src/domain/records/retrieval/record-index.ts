import type { RecordIndexDocument, RecordIndexHit, RecordIndexRef, RecordIndexSourceType } from "./model.js";

export interface RecordIndex {
  isCurrent(ref: RecordIndexRef, contentHash: string, eventAt: string): Promise<boolean>;
  replace(document: RecordIndexDocument, embedding: number[]): Promise<void>;
  remove(ref: RecordIndexRef): Promise<void>;
  listRecordRefs(userId: string, recordId: string): Promise<RecordIndexRef[]>;
  search(input: {
    userId: string;
    sourceTypes: RecordIndexSourceType[];
    embedding: number[];
    limit: number;
  }): Promise<RecordIndexHit[]>;
}
