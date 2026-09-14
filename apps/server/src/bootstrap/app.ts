import { Hono } from "hono";
import { cors } from "hono/cors";
import type { LocalMediaQueue } from "../infrastructure/queue/media-queue.js";
import type { LocalVectorQueue } from "../infrastructure/queue/vector-queue.js";
import type { OssStorage } from "../infrastructure/clients/oss-client.js";
import type { SqliteMediaRepository } from "../domain/media/sqlite-repository.js";
import { nowIso } from "../infrastructure/time.js";
import type { RecordRepository } from "../domain/records/repository.js";
import { createRecordRoutes } from "../routes/records.js";
import { createUploadRoutes } from "../routes/media.js";
import { validUserId } from "../routes/request-user.js";
import { logAccess, logError } from "../infrastructure/logging/logger.js";
import { CreationReadRepository } from "../domain/creations/creation-repository.js";
import { createCreationReadRoutes } from "../routes/creations.js";
import { CreationProposalRepository } from "../domain/creations/proposal-repository.js";
import { createCreationProposalRoutes } from "../routes/proposals.js";

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

export function createApp(records: RecordRepository, media: SqliteMediaRepository, queue: LocalMediaQueue, oss: OssStorage, ai: { apiKey: string; asrBaseUrl: string; vlBaseUrl: string }, vectors?: LocalVectorQueue, creationRead?: CreationReadRepository, creationProposals?: CreationProposalRepository) {
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
    if (!validUserId(c.req.header("x-user-id")?.trim())) return c.json({ success: false, errorCode: "UNAUTHORIZED", errorMsg: "Missing or invalid x-user-id" }, 401);
    await next();
  });
  app.get("/health", c => c.json({ status: "ok", timestamp: nowIso() }));
  app.route("/api/uploads", createUploadRoutes(media, oss, ai));
  app.route("/api/records", createRecordRoutes(records, media, queue, vectors));
  if (creationRead) app.route("/api", createCreationReadRoutes(creationRead));
  if (creationProposals) app.route("/api", createCreationProposalRoutes(creationProposals));
  app.get("/api/media/:id", async c => { const asset = await media.findMedia(c.req.param("id"), c.req.header("x-user-id")!.trim()); return asset?.status === "ready" ? c.redirect(oss.readUrl(asset.objectKey), 302) : c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404); });
  return app;
}
