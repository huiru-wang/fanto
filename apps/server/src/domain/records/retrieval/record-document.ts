import { formatLocationContext } from "@fanto/shared";
import type { Record } from "../record.js";
export function buildRecordEmbeddingText(record: Record): string {
  const sections: string[] = [];
  const text = record.content.text.trim();
  if (text) sections.push(`用户记录：${text}`);
  for (const block of record.content.blocks) {
    if (block.type === "location") sections.push(`地点：${formatLocationContext(block)}`);
    if (block.type === "image" && block.description?.trim()) sections.push(`图片描述：${block.description.trim()}`);
  }
  return sections.join("\n\n");
}

export function recordSearchPreview(record: Record): string {
  return buildRecordEmbeddingText(record).slice(0, 1_000);
}
