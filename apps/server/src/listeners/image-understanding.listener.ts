import type { ImageUnderstanding } from "../infrastructure/ai/image-understanding.js";
import type { LocalMediaQueue } from "../infrastructure/local-media-queue.js";
import type { OssStorage } from "../infrastructure/oss-storage.js";
import type { SqliteMediaRepository } from "../infrastructure/repositories/sqlite-media.repository.js";
import type { RecordRepository } from "../modules/record/record.repository.js";

export function registerImageUnderstandingListener(queue: LocalMediaQueue, records: RecordRepository, media: SqliteMediaRepository, oss: OssStorage, image: ImageUnderstanding) {
  queue.on("image_understanding", async task => {
    const record = await records.findById(task.recordId);
    if (!record || record.userId !== task.userId || record.version !== task.version || !record.content.blocks.some(block => block.mediaId === task.mediaId && block.type === "image")) return;
    const asset = await media.findMedia(task.mediaId, task.userId);
    if (!asset || asset.mediaType !== "image" || asset.extData.recordId !== task.recordId) return;
    const result = await image.describe({ imageUrl: oss.readUrl(asset.objectKey) });
    await records.writeImageDescription({ ...task, description: result.description });
  });
}
