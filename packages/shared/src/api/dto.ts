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

export type TopicDto = {
  id: string;
  userId: string;
  sessionId: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  pendingActions: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  extData: { [key: string]: unknown } | null;
};
