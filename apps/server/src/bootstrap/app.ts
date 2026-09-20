import { Hono } from "hono";
import { cors } from "hono/cors";
import type { RecordPostprocessQueue } from "../infrastructure/queue/record-postprocess-queue.js";
import type { OssStorage } from "../infrastructure/clients/oss-client.js";
import type { MediaAsset, SqliteMediaRepository } from "../domain/media/sqlite-repository.js";
import { nowIso } from "../infrastructure/time.js";
import type { RecordRepository } from "../domain/records/repository.js";
import { createRecordRoutes } from "../routes/records.js";
import { createUploadRoutes } from "../routes/media.js";
import { requireUserId, validUserId } from "../routes/request-user.js";
import { logAccess, logError } from "../infrastructure/logging/logger.js";
import { CreationReadRepository } from "../domain/creations/creation-repository.js";
import { createCreationReadRoutes } from "../routes/creations.js";
import { CreationProposalRepository } from "../domain/creations/proposal-repository.js";
import { createCreationProposalRoutes } from "../routes/proposals.js";
import type { MemoryService } from "../domain/memory/memory-service.js";

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    /authorization|password|secret|token|key/i.test(key) ? [key, "[REDACTED]"] : [key, redact(item)],
  ));
};
const jsonBody = async (response: Response) => {
  if (!response.headers.get("content-type")?.includes("application/json")) return null;
  try { return redact(JSON.parse(await response.clone().text())); } catch { return null; }
};

const MEDIA_READ_TTL_MS = 300_000;

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function presentableMediaMetadata(asset: MediaAsset) {
  const rawCapture = asset.extData.capture;
  const capture = rawCapture && typeof rawCapture === "object" ? rawCapture as Record<string, unknown> : {};
  return {
    mediaId: asset.mediaId,
    mediaType: asset.mediaType,
    mimeType: asset.mimeType,
    ...(positiveInt(capture.width) ? { width: positiveInt(capture.width) } : {}),
    ...(positiveInt(capture.height) ? { height: positiveInt(capture.height) } : {}),
    ...(positiveInt(capture.durationMs) ? { durationMs: positiveInt(capture.durationMs) } : {}),
  };
}

export function createApp(records: RecordRepository, media: SqliteMediaRepository, queue: RecordPostprocessQueue, oss: OssStorage, creationRead?: CreationReadRepository, creationProposals?: CreationProposalRepository, memory?: Pick<MemoryService, "searchRecords">, allowedUserIds?: ReadonlySet<string>) {
  const app = new Hono();
  app.onError((error, c) => {
    logError("http", "Unhandled request error", { method: c.req.method, path: c.req.path, error: error.message });
    return c.json({ success: false, errorCode: "INTERNAL_ERROR", errorMsg: "Internal server error" }, 500);
  });
  app.use("*", cors());
  app.use("/api/*", async (c, next) => {
    const requestBody = c.req.header("content-type")?.includes("application/json") ? await c.req.raw.clone().json().then(redact).catch(() => null) : null;
    await next();
    logAccess({ method: c.req.method, path: c.req.path, requestBody, responseBody: await jsonBody(c.res), status: c.res.status });
  });
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const userId = c.req.header("x-user-id")?.trim();
    if (!validUserId(userId) || (allowedUserIds && !allowedUserIds.has(userId))) return c.json({ success: false, errorCode: "UNAUTHORIZED", errorMsg: "Unauthorized" }, 401);
    await next();
  });
  app.get("/health", c => c.json({ status: "ok", timestamp: nowIso() }));
  app.route("/api/uploads", createUploadRoutes(media, oss));
  app.route("/api/records", createRecordRoutes(records, media, queue, memory));
  if (creationRead) app.route("/api", createCreationReadRoutes(creationRead));
  if (creationProposals) app.route("/api", createCreationProposalRoutes(creationProposals));
  app.get("/api/media/:id/meta", async c => {
    const asset = await media.findMedia(c.req.param("id"), requireUserId(c.req.raw));
    return asset?.status === "ready"
      ? c.json({ success: true, result: presentableMediaMetadata(asset), errorCode: null, errorMsg: null })
      : c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404);
  });
  app.get("/api/media/:id/url", async c => {
    const asset = await media.findMedia(c.req.param("id"), requireUserId(c.req.raw));
    return asset?.status === "ready"
      ? c.json({
        success: true,
        result: {
          url: oss.readUrl(asset.objectKey),
          expiresAt: new Date(Date.now() + MEDIA_READ_TTL_MS).toISOString(),
        },
        errorCode: null,
        errorMsg: null,
      })
      : c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404);
  });
  app.get("/api/media/:id", async c => { const asset = await media.findMedia(c.req.param("id"), requireUserId(c.req.raw)); return asset?.status === "ready" ? c.redirect(oss.readUrl(asset.objectKey), 302) : c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404); });
  return app;
}
