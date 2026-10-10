import { randomUUID } from "node:crypto";
import type { AudioTranscriptionClient } from "../infrastructure/clients/audio-client.js";
import type { ImageUnderstanding } from "../infrastructure/clients/image-client.js";
import type { OssStorage } from "../infrastructure/clients/oss-client.js";
import type { RecordPostprocessQueue } from "../event/record-postprocess-queue.js";
import type { RecordEmbeddingQueue } from "../event/record-embedding-queue.js";
import type { AgentExecutionQueue } from "../event/agent-execution-queue.js";
import type { MediaService } from "../domain/media/index.js";
import type { RecordService } from "../domain/records/index.js";
import { logError, logInfo, logSummary } from "../infrastructure/logging/logger.js";

export function registerRecordPostprocessListener(
  queue: RecordPostprocessQueue,
  records: RecordService,
  media: MediaService,
  oss: OssStorage,
  image: ImageUnderstanding,
  audio: AudioTranscriptionClient,
  embeddingQueue: RecordEmbeddingQueue,
  agentQueue: AgentExecutionQueue,
) {
  queue.on(async task => {
    const startedAt = Date.now();
    const runId = randomUUID();
    const details = {...task, runId};
    const record = await records.claimPostprocess({ ...task, runId });
    if (!record) {
      logInfo("record-postprocess", "skipped", {...details, reason:"record_not_claimable"});
      return;
    }
    logInfo("record-postprocess", "started", details);

    let completed;
    try {
      const assets = await media.findOwnedByIds(task.userId, record.content.blocks.flatMap(block => block.type === "location" ? [] : [block.mediaId]));
      const byId = new Map(assets.filter(asset => asset.status === "ready" && asset.extData.recordId === task.recordId).map(asset => [asset.mediaId, asset]));
      const imageJobs = record.content.blocks.filter(block => block.type === "image").flatMap(block => {
        const asset = byId.get(block.mediaId);
        return asset && !block.description
          ? [image.describe({ imageUrl: oss.readUrl(asset.objectKey) })
              .then(result => ({ mediaId: block.mediaId, description: result.description }))
              .catch(error => {
                logError("record-postprocess", "Image understanding failed", {
                  ...details,
                  mediaId: block.mediaId,
                  error: logSummary(error),
                });
                return null;
              })]
          : [];
      });
      const audioJobs = record.content.blocks.filter(block => block.type === "audio").flatMap(block => {
        const asset = byId.get(block.mediaId);
        return asset && !block.transcription
          ? [audio.transcribe({ audioUrl: oss.readUrl(asset.objectKey) })
              .then(result => ({
                mediaId: block.mediaId,
                transcription: result.transcript,
                asr: {
                  status: "succeeded" as const,
                  model: result.model,
                  emotion: result.emotion,
                  language: result.language,
                  completedAt: new Date().toISOString(),
                },
              }))
              .catch(error => {
                logError("record-postprocess", "Audio transcription failed", {
                  ...details,
                  mediaId: block.mediaId,
                  error: logSummary(error),
                });
                return { mediaId: block.mediaId, asr: { status: "failed" as const, errorCode: "TRANSCRIPTION_FAILED" } };
              })]
          : [];
      });

      const [imageResults, audioResults] = await Promise.all([Promise.all(imageJobs), Promise.all(audioJobs)]);
      completed = await records.completePostprocess({
        ...task,
        runId,
        images: imageResults.flatMap(result => result ? [result] : []),
        audio: audioResults,
      });
    } catch (error) {
      logError("record-postprocess", "failed", {...details, error:logSummary(error), durationMs:Date.now()-startedAt});
      await records.releasePostprocess({ ...task, runId });
      throw error;
    }

    if (!completed) {
      logInfo("record-postprocess", "skipped", {...details, reason:"completion_not_applied", durationMs:Date.now()-startedAt});
      return;
    }
    logInfo("record-postprocess", "completed", {...details, durationMs:Date.now()-startedAt});

    embeddingQueue.publish({...task});
    agentQueue.publish({type:"proposal", ...task});
  });
}
