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

export type LocationContentBlock = {
  type: "location";
  name: string;
  countryCode?: string;
  country?: string;
  province?: string;
  city?: string;
  district?: string;
  latitude: number;
  longitude: number;
};

export function formatLocationContext(location: LocationContentBlock): string {
  const values = [location.country, location.province, location.city, location.district, location.name]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value));
  const seen = new Set<string>();
  const distinct = values.filter(value => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return `地点：${distinct.join(" ")}`;
}

export type RecordContent = {
  text: string;
  blocks: Array<ImageContentBlock | AudioContentBlock | LocationContentBlock>;
};

export function isAudioContentBlock(block: RecordContent["blocks"][number]): block is AudioContentBlock {
  return block.type === "audio";
}
