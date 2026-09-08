import type { RecordContent } from "@fanto/shared";

export type RecordStatus = "active";

export interface Record {
  extData: { [key: string]: unknown } | null;
  id: string;
  userId: string;
  source: string;
  content: RecordContent;
  version: number;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}
