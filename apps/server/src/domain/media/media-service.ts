import { mediaMime, mediaObjectKey, normalizeMimeType, taskObjectKey } from "./mime.js";
import { PostgresMediaRepository, type MediaAsset } from "./postgres-repository.js";
import type { MediaVariant, OssStorage } from "../../infrastructure/clients/oss-client.js";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";

export class MediaService {
  constructor(private readonly media: PostgresMediaRepository, private readonly oss: OssStorage) {}
  static create(db: Kysely<DB>, oss: OssStorage) { return new MediaService(new PostgresMediaRepository(db), oss); }
  findOwnedByIds(userId: string, ids: string[]) { return this.media.findMediaByIds(ids, userId); }
  async createUpload(userId: string, input: { mimeType: string; bytes: number }) {
    const descriptor = mediaMime(input.mimeType); if (!descriptor) return null;
    const mediaId = crypto.randomUUID();
    const created = await this.media.create({ mediaId, userId, objectKey: mediaObjectKey(userId, mediaId, descriptor.extension), mediaType: descriptor.mediaType, mimeType: descriptor.mimeType, bytes: input.bytes });
    return { mediaId: created.mediaId, uploadUrl: this.oss.putUrl(created.objectKey, created.mimeType), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  }
  async createGeneratedFile(input: { userId: string; filename: string; mimeType: "text/plain" | "text/markdown" | "text/html"; data: Buffer; extData?: Record<string, unknown> }) {
    const filename = safeFilename(input.filename);
    const mediaId = crypto.randomUUID();
    const objectKey = `users/${input.userId}/media/${mediaId}/${filename}`;
    await this.oss.putObject(objectKey, input.data, input.mimeType);
    try {
      return await this.media.createReadyFile({
        mediaId,
        userId: input.userId,
        objectKey,
        mimeType: input.mimeType,
        bytes: input.data.byteLength,
        extData: { ...(input.extData ?? {}), filename },
      });
    } catch (error) {
      await this.oss.remove(objectKey).catch(() => {});
      throw error;
    }
  }
  async createTaskGeneratedFile(input: {
    userId: string;
    workerSessionId: string;
    filename: string;
    mimeType: "text/plain" | "text/markdown" | "text/html";
    data: Buffer;
    completedAt: Date;
    extData?: Record<string, unknown>;
  }) {
    const filename = safeFilename(input.filename);
    const mediaId = crypto.randomUUID();
    const objectKey = taskObjectKey(input.userId, input.workerSessionId, filename, input.completedAt);
    await this.oss.putObject(objectKey, input.data, input.mimeType);
    try {
      return await this.media.createReadyFile({
        mediaId,
        userId: input.userId,
        objectKey,
        mimeType: input.mimeType,
        bytes: input.data.byteLength,
        extData: { ...(input.extData ?? {}), filename },
      });
    } catch (error) {
      await this.oss.remove(objectKey).catch(() => {});
      throw error;
    }
  }
  async completeUpload(userId: string, id: string, capture: Record<string, unknown>) {
    const current = await this.media.findMedia(id, userId); if (!current) return { kind: "not_found" } as const;
    try { const head: any = await this.oss.head(current.objectKey); const bytes = Number(head.res?.headers?.["content-length"] ?? head.res?.headers?.["Content-Length"]); const mimeType = head.res?.headers?.["content-type"] ?? head.res?.headers?.["Content-Type"];
      if (bytes !== current.bytes || normalizeMimeType(mimeType) !== current.mimeType) return { kind: "mismatch" } as const;
      const result = await this.media.complete(id, userId, capture); return result ? { kind: "ok", media: result } as const : { kind: "incomplete" } as const;
    } catch { return { kind: "incomplete" } as const; }
  }
  async readyMetadata(userId: string, id: string) { const asset = await this.media.findMedia(id, userId); return asset?.status === "ready" ? metadata(asset) : null; }
  async readUrl(userId: string, id: string, variant: MediaVariant = "original") { const asset = await this.media.findMedia(id, userId); if (asset?.status !== "ready") return null; const resolvedVariant = asset.mediaType === "image" ? variant : "original"; return { url: this.oss.readUrl(asset.objectKey, resolvedVariant), expiresAt: new Date(Date.now() + 300_000).toISOString() }; }
  async redirectUrl(userId: string, id: string) { const asset = await this.media.findMedia(id, userId); return asset?.status === "ready" ? this.oss.readUrl(asset.objectKey) : null; }
}

export function metadata(asset: MediaAsset) {
  const capture = asset.extData.capture && typeof asset.extData.capture === "object"
    ? asset.extData.capture as Record<string, unknown>
    : {};
  const positive = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
  const filename = typeof asset.extData.filename === "string" ? asset.extData.filename : undefined;
  return {
    mediaId: asset.mediaId,
    mediaType: asset.mediaType,
    mimeType: asset.mimeType,
    ...(asset.mediaType === "file" ? { bytes: asset.bytes, ...(filename ? { filename } : {}) } : {}),
    ...(positive(capture.width) ? { width: positive(capture.width) } : {}),
    ...(positive(capture.height) ? { height: positive(capture.height) } : {}),
    ...(positive(capture.durationMs) ? { durationMs: positive(capture.durationMs) } : {}),
  };
}

function safeFilename(value: string): string {
  const filename = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  if (!filename || filename === "." || filename === "..") throw new Error("Invalid generated filename");
  return filename.slice(0, 200);
}
