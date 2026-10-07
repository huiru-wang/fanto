import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mediaMime, mediaObjectKey, normalizeMimeType, taskObjectKey } from "./mime.js";
import { PostgresMediaRepository, type MediaAsset } from "./postgres-repository.js";
import type { MediaVariant, OssStorage } from "../../infrastructure/clients/oss-client.js";
import type { Transaction, Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";

export class MediaService {
  constructor(private readonly media: PostgresMediaRepository, private readonly oss: OssStorage) {}
  static create(db: Kysely<DB>, oss: OssStorage) { return new MediaService(new PostgresMediaRepository(db), oss); }
  findOwnedByIds(userId: string, ids: string[], options: { transaction?: Transaction<DB> } = {}) { return this.media.findMediaByIds(ids, userId, options.transaction); }
  async createGeneratedImage(input: { userId: string; mediaId: string; creationRunId: string; proposalId: string; projectId: string; imageIndex: number; data: Buffer; width: number; height: number }) {
    const current = await this.media.findMedia(input.mediaId, input.userId);
    if (current) {
      if (current.extData.creationRunId !== input.creationRunId || current.extData.imageIndex !== input.imageIndex || current.status !== "ready" || current.mediaType !== "image") throw new Error("Generated media registration conflict");
      return metadata(current);
    }
    const decoded = await sharp(input.data, { limitInputPixels: 40_000_000 }).metadata();
    if (decoded.format !== "png" || decoded.width !== input.width || decoded.height !== input.height || input.data.length > 20 * 1024 * 1024) throw new Error("Invalid generated image");
    const key = `users/${input.userId}/creations/${input.creationRunId}/${input.mediaId}.png`;
    await this.oss.putObject(key, input.data, "image/png");
    try {
      const saved = await this.media.createReadyImage({ mediaId: input.mediaId, userId: input.userId, objectKey: key, mimeType: "image/png", bytes: input.data.length, extData: { source: "creation", creationRunId: input.creationRunId, proposalId: input.proposalId, projectId: input.projectId, imageIndex: input.imageIndex, capture: { width: input.width, height: input.height } } });
      return metadata(saved);
    } catch (error) {
      // On a lost DB acknowledgement, preserve a possibly committed object; remove only confirmed orphans.
      const exists = await this.media.findMedia(input.mediaId, input.userId).catch(() => undefined);
      if (exists === null) await this.oss.remove(key).catch(() => {});
      throw error;
    }
  }
  async withGenerationReferences<T>(userId: string, ids: string[], runId: string, operation: (urls: string[]) => Promise<T>) {
    const assets = await this.media.findMediaByIds(ids, userId);
    if (assets.length !== ids.length || assets.some(a => a.status !== "ready" || a.mediaType !== "image" || a.bytes > 20 * 1024 * 1024)) throw new Error("SOURCE_MEDIA_UNAVAILABLE");
    const keys: string[] = [], urls: string[] = [];
    try {
      for (const id of ids) {
        const asset = assets.find(a => a.mediaId === id)!;
        const data = await this.oss.getObject(asset.objectKey);
        if (data.length > 20 * 1024 * 1024) throw new Error("SOURCE_MEDIA_UNAVAILABLE");
        const image = sharp(data, { limitInputPixels: 40_000_000, failOn: "warning" }), meta = await image.metadata();
        if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || !meta.width || !meta.height || Math.max(meta.width, meta.height) / Math.min(meta.width, meta.height) > 8 || (meta.pages ?? 1) > 1) throw new Error("SOURCE_MEDIA_UNAVAILABLE");
        const width = meta.autoOrient?.width ?? meta.width, height = meta.autoOrient?.height ?? meta.height;
        const scale = Math.max(384 / Math.min(width, height), Math.min(1, 3072 / Math.max(width, height)));
        const adapted = await image.rotate().resize({ width: Math.round(width * scale), height: Math.round(height * scale), fit: "inside" }).jpeg({ quality: 92 }).toBuffer();
        const key = `users/${userId}/creations/${runId}/references/${randomUUID()}.jpg`;
        keys.push(key);
        await this.oss.putObject(key, adapted, "image/jpeg");
        urls.push(this.oss.readUrl(key, "original", 900));
      }
      return await operation(urls);
    } finally { await Promise.all(keys.map(key => this.oss.remove(key).catch(() => {}))); }
  }
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
  async readTaskArtifact(userId: string, id: string, maxBytes = 2 * 1024 * 1024) {
    const asset = await this.media.findMedia(id, userId);
    const source = asset?.extData.source;
    const taskId = asset?.extData.taskId;
    const taskRunId = asset?.extData.taskRunId;
    const filename = asset?.extData.filename;
    const supportedMime = asset?.mimeType === "text/html" || asset?.mimeType === "text/markdown" || asset?.mimeType === "text/plain";
    if (!asset || asset.status !== "ready" || asset.mediaType !== "file" || source !== "task" || !supportedMime
      || typeof taskId !== "string" || typeof taskRunId !== "string" || typeof filename !== "string") {
      return { kind: "not_found" as const };
    }
    if (asset.bytes > maxBytes) return { kind: "too_large" as const };
    const data = await this.oss.getObject(asset.objectKey);
    if (data.byteLength > maxBytes) return { kind: "too_large" as const };
    return {
      kind: "ok" as const,
      artifact: {
        mediaId: asset.mediaId,
        taskId,
        taskRunId,
        filename,
        mimeType: asset.mimeType as "text/html" | "text/markdown" | "text/plain",
        bytes: asset.bytes,
        content: data.toString("utf8"),
      },
    };
  }
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
