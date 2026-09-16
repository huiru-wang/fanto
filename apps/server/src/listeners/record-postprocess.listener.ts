import { randomUUID } from "node:crypto";
import type { AudioTranscriptionClient } from "../infrastructure/clients/audio-client.js";
import type { ImageUnderstanding } from "../infrastructure/clients/image-client.js";
import type { OssStorage } from "../infrastructure/clients/oss-client.js";
import type { RecordPostprocessQueue } from "../infrastructure/queue/record-postprocess-queue.js";
import type { RecordMemoryService } from "../domain/memory/record-index.js";
import type { SqliteMediaRepository } from "../domain/media/sqlite-repository.js";
import type { RecordRepository } from "../domain/records/repository.js";
import { logError } from "../infrastructure/logging/logger.js";

type Indexer = Pick<RecordMemoryService, "index">;

export function registerRecordPostprocessListener(queue: RecordPostprocessQueue, records: RecordRepository, media: SqliteMediaRepository, oss: OssStorage, image: ImageUnderstanding, audio: AudioTranscriptionClient, memory: Indexer) {
  queue.on(async task => {
    const runId = randomUUID();
    const record = await records.claimPostprocess({ ...task, runId });
    if (!record) return;
    try {
      const assets = await media.findMediaByIds(record.content.blocks.map(block => block.mediaId), task.userId);
      const byId = new Map(assets.filter(asset => asset.status === "ready" && asset.extData.recordId === task.recordId).map(asset => [asset.mediaId, asset]));
      const imageJobs = record.content.blocks.filter(block => block.type === "image").flatMap(block => {
        const asset = byId.get(block.mediaId);
        return asset && !block.description ? [image.describe({ imageUrl: oss.readUrl(asset.objectKey) }).then(result => ({ mediaId: block.mediaId, description: result.description })).catch(error => { logError("record-postprocess", "Image understanding failed", { recordId: task.recordId, mediaId: block.mediaId, error: error instanceof Error ? error.message : String(error) }); return null; })] : [];
      });
      const audioJobs = record.content.blocks.filter(block => block.type === "audio").flatMap(block => {
        const asset = byId.get(block.mediaId);
        return asset && !block.transcription ? [audio.transcribe({ audioUrl: oss.readUrl(asset.objectKey) }).then(result => ({ mediaId: block.mediaId, transcription: result.transcript, asr: { status: "succeeded" as const, model: result.model, emotion: result.emotion, language: result.language, completedAt: new Date().toISOString() } })).catch(error => { logError("record-postprocess", "Audio transcription failed", { recordId: task.recordId, mediaId: block.mediaId, error: error instanceof Error ? error.message : String(error) }); return { mediaId: block.mediaId, asr: { status: "failed" as const, errorCode: "TRANSCRIPTION_FAILED" } }; })] : [];
      });
      const [imageResults, audioResults] = await Promise.all([Promise.all(imageJobs), Promise.all(audioJobs)]);
      const completed = await records.completePostprocess({ ...task, runId, images: imageResults.flatMap(result => result ? [result] : []), audio: audioResults });
      if (completed) await memory.index({ userId: task.userId, recordId: task.recordId, operation: "replace" });
    } catch (error) {
      await records.releasePostprocess({ ...task, runId });
      throw error;
    }
  });
}
