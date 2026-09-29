export type ImageContentBlock = {
  type: "image";
  mediaId: string;
  description?: string;
};

export type AudioAsrMetadata = {
  status: "succeeded" | "failed";
  model?: string;
  emotion?: string;
  language?: string;
  completedAt?: string;
  errorCode?: string;
};

export type AudioContentBlock = {
  type: "audio";
  mediaId: string;
  durationMs?: number;
  transcription?: string;
  asr?: AudioAsrMetadata;
};

export type RecordContent = {
  text: string;
  blocks: Array<ImageContentBlock | AudioContentBlock>;
};

export function isAudioContentBlock(block: RecordContent["blocks"][number]): block is AudioContentBlock {
  return block.type === "audio";
}
