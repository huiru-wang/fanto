import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SessionManager } from "./agent/session.js";
import type { AppConfig } from "./env.js";
import type { LocalMediaQueue } from "./infrastructure/local-media-queue.js";
import type { OssStorage } from "./infrastructure/oss-storage.js";
import type { SqliteMediaRepository } from "./infrastructure/repositories/sqlite-media.repository.js";
import type { MessageRepository } from "./modules/message/message.repository.js";
import { nowIso } from "./infrastructure/time.js";
import type { RecordRepository } from "./modules/record/record.repository.js";
import { createRecordRoutes } from "./routes/records.js";
import { createUploadRoutes } from "./routes/uploads.js";
import { createAgentRoutes } from "./routes/agent.js";
import { validUserId } from "./interfaces/request-user.js";
import { logAccess } from "./infrastructure/logger.js";

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

export function createApp(records: RecordRepository, media: SqliteMediaRepository, queue: LocalMediaQueue, oss: OssStorage, ai: { apiKey: string; baseUrl: string }, config?: AppConfig, sessions?: SessionManager, messages?: MessageRepository) {
  const app = new Hono();
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
  app.route("/api/records", createRecordRoutes(records, media, queue));
  if (config && sessions && messages) app.route("/api/agent", createAgentRoutes(sessions, config, messages));
  app.get("/api/media/:id", async c => { const asset = await media.findMedia(c.req.param("id"), c.req.header("x-user-id")!.trim()); return asset?.status === "ready" ? c.redirect(oss.readUrl(asset.objectKey), 302) : c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404); });
  return app;
}
