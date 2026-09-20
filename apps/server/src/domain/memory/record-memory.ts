import { createHash } from "node:crypto";
import type { Record } from "../records/record.js";
import type { MemoryDocument, MemorySourceType } from "./model.js";

const hash = (content: string) => createHash("sha256").update(content).digest("hex");
const mediaSourceId = (recordId: string, mediaId: string) => `${recordId}:${mediaId}`;

function document(
  record: Record,
  sourceType: MemorySourceType,
  sourceId: string,
  mediaId: string | null,
  content: string,
): MemoryDocument {
  return {
    userId: record.userId,
    sourceType,
    sourceId,
    recordId: record.id,
    mediaId,
    eventAt: record.eventAt,
    content,
    contentHash: hash(content),
  };
}

export function buildRecordMemoryDocuments(record: Record): MemoryDocument[] {
  const documents: MemoryDocument[] = [];

  const text = record.content.text.trim();
  if (text) {
    const content = `用户记录：${text}`;
    documents.push(document(record, "record_text", record.id, null, content));
  }

  for (const block of record.content.blocks) {
    if (block.type === "image" && block.description?.trim()) {
      const content = `图片描述：${block.description.trim()}`;
      documents.push(document(record, "image", mediaSourceId(record.id, block.mediaId), block.mediaId, content));
    }
    if (block.type === "audio" && block.transcription?.trim()) {
      const content = `音频转写：${block.transcription.trim()}`;
      documents.push(document(record, "audio", mediaSourceId(record.id, block.mediaId), block.mediaId, content));
    }
  }

  return documents;
}

export function parseMemorySource(sourceType: MemorySourceType, sourceId: string): { recordId: string; mediaId: string | null } {
  if (sourceType === "record_text") return { recordId: sourceId, mediaId: null };
  const separator = sourceId.indexOf(":");
  if (separator <= 0 || separator === sourceId.length - 1) throw new Error(`Invalid ${sourceType} memory source id`);
  return { recordId: sourceId.slice(0, separator), mediaId: sourceId.slice(separator + 1) };
}
