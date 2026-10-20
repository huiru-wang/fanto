import type { RecordStatus } from '../models/record.js';
import type { RecordContent } from '../record-content.js';

export type RecordDto = {
  id: string;
  userId: string;
  source: string;
  content: RecordContent;
  version: number;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  extData: { [key: string]: unknown } | null;
};

export type RecordReadDto = RecordDto;
