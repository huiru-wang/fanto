import type { RecordContent } from "@fanto/shared";

export type RecordStatus = "pending" | "updated" | "processing" | "processed";

export interface Record {
  extData: { [key: string]: unknown } | null;
  id: string;
  userId: string;
  source: string;
  content: RecordContent;
  version: number;
  status: RecordStatus;
  taskId: string | null;
  eventAt: string;
  createdAt: string;
  updatedAt: string;
}
