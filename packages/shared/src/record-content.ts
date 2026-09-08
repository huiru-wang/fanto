export type ImageContentBlock = { mediaId: string; description?: string };
export type AudioContentBlock = { mediaId: string; transcript?: string; language?: string | null; emotion?: string | null };
export type RecordContent = { text: string; blocks: Array<ImageContentBlock | AudioContentBlock> };

export function isAudioContentBlock(block: RecordContent["blocks"][number]): block is AudioContentBlock {
  return "transcript" in block || "language" in block || "emotion" in block;
}
