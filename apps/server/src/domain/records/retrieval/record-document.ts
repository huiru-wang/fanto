import { createHash } from "node:crypto";
import { formatLocationContext } from "@fanto/shared";
import type { Record } from "../record.js";
import type { RecordIndexDocument, RecordIndexSourceType } from "./model.js";

const hash = (content: string) => createHash("sha256").update(content).digest("hex");
const mediaSourceId = (recordId: string, mediaId: string) => `${recordId}:${mediaId}`;

function document(record: Record, sourceType: RecordIndexSourceType, sourceId: string, mediaId: string | null, content: string): RecordIndexDocument {
  return { userId: record.userId, sourceType, sourceId, recordId: record.id, mediaId, eventAt: record.eventAt, content, contentHash: hash(content) };
}

export function buildRecordIndexDocuments(record: Record): RecordIndexDocument[] {
  const documents: RecordIndexDocument[] = [];
  const text = record.content.text.trim();
  if (text) documents.push(document(record, "record_text", record.id, null, `用户记录：${text}`));
  for (const block of record.content.blocks) {
    if (block.type === "location") documents.push(document(record, "record_location", record.id, null, formatLocationContext(block)));
    if (block.type === "image" && block.description?.trim()) documents.push(document(record, "image", mediaSourceId(record.id, block.mediaId), block.mediaId, `图片描述：${block.description.trim()}`));
    if (block.type === "audio" && block.transcription?.trim()) documents.push(document(record, "audio", mediaSourceId(record.id, block.mediaId), block.mediaId, `音频转写：${block.transcription.trim()}`));
  }
  return documents;
}

export function parseRecordIndexSource(sourceType: RecordIndexSourceType, sourceId: string): { recordId: string; mediaId: string | null } {
  if (sourceType === "record_text" || sourceType === "record_location") return { recordId: sourceId, mediaId: null };
  const separator = sourceId.indexOf(":");
  if (separator <= 0 || separator === sourceId.length - 1) throw new Error(`Invalid ${sourceType} record index source id`);
  return { recordId: sourceId.slice(0, separator), mediaId: sourceId.slice(separator + 1) };
}
