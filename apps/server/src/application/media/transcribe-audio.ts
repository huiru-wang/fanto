import { transcribeAudio, type AudioTranscription } from "../../infrastructure/ai/audio-transcription.js";
import type { OssStorage } from "../../infrastructure/oss-storage.js";
import type { SqliteMediaRepository } from "../../infrastructure/repositories/sqlite-media.repository.js";

export async function streamAudioTranscription(input: { mediaId: string; userId: string; oss: OssStorage; media: SqliteMediaRepository; apiKey: string; baseUrl: string; signal?: AbortSignal; onDelta: (text: string) => Promise<void> }): Promise<AudioTranscription> {
  const asset = await input.media.findMedia(input.mediaId, input.userId);
  if (!asset || asset.mediaType !== "audio") throw new Error("Audio not found");
  return transcribeAudio({ audioUrl: input.oss.readUrl(asset.objectKey), apiKey: input.apiKey, baseUrl: input.baseUrl, signal: input.signal, onDelta: input.onDelta });
}
