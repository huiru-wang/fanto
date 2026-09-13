export type ImageContentBlock = { type: "image"; mediaId: string; description?: string };
export type AudioContentBlock = { type: "audio"; mediaId: string };
export type RecordContent = { text: string; blocks: Array<ImageContentBlock | AudioContentBlock> };

export function isAudioContentBlock(block: RecordContent["blocks"][number]): block is AudioContentBlock {
  return block.type === "audio";
}
