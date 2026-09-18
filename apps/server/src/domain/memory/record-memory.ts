import { createHash } from "node:crypto";
import type { Record } from "../records/record.js";
import type { MemoryDocument } from "./model.js";

export function buildRecordMemoryDocument(record: Record): MemoryDocument | null {
  const parts = [
    record.content.text.trim() ? `用户记录：${record.content.text.trim()}` : "",
    ...record.content.blocks.flatMap(block => {
      if (block.type === "image" && block.description?.trim()) return [`图片描述：${block.description.trim()}`];
      if (block.type === "audio" && block.transcription?.trim()) return [`音频转写：${block.transcription.trim()}`];
      return [];
    }),
  ].filter(Boolean);

  if (!parts.length) return null;

  const content = parts.join("\n");
  return {
    userId: record.userId,
    sourceType: "record",
    sourceId: record.id,
    content,
    contentHash: createHash("sha256").update(content).digest("hex"),
  };
}
