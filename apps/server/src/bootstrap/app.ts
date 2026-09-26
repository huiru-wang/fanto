import { Hono } from "hono";
import { cors } from "hono/cors";
import type { RecordPostprocessQueue } from "../infrastructure/queue/record-postprocess-queue.js";
import type { OssStorage } from "../infrastructure/clients/oss-client.js";
import type { MediaAsset, PostgresMediaRepository } from "../domain/media/postgres-repository.js";
import { nowIso } from "../infrastructure/time.js";
import type { RecordRepository } from "../domain/records/repository.js";
import { createRecordRoutes } from "../routes/records.js";
import { createUploadRoutes } from "../routes/media.js";
import { bearerToken, requireUserId, runWithRequestPrincipal } from "../routes/request-user.js";
import type { JwtTokenService } from "../infrastructure/auth/jwt-token-service.js";
import type { AuthService } from "../domain/auth/service.js";
import { AuthError } from "../domain/auth/errors.js";
import { createAuthRoutes } from "../routes/auth.js";
import { logAccess, logError } from "../infrastructure/logging/logger.js";
import { CreationReadRepository } from "../domain/creations/creation-repository.js";
import { createCreationReadRoutes } from "../routes/creations.js";
import { CreationProposalRepository } from "../domain/creations/proposal-repository.js";
import { createCreationProposalRoutes } from "../routes/proposals.js";
import type { MemoryService } from "../domain/memory/memory-service.js";
import type { PreferenceService } from "../domain/preferences/preference-service.js";
import { createPreferenceRoutes } from "../routes/preferences.js";

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    /authorization|password|secret|token|key|nonce|display.?hint|email/i.test(key) ? [key, "[REDACTED]"] : [key, redact(item)],
  ));
};
const redactPreferenceData = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactPreferenceData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    /^(content|quote|sourceQuote|source_quote)$/i.test(key) ? [key, "[REDACTED]"] : [key, redactPreferenceData(item)],
  ));
};
export const logSafeBody = (path: string, value: unknown) => path.startsWith("/api/preferences")
  ? redactPreferenceData(redact(value))
  : /^\/api\/media\/[^/]+\/url$/.test(path)
    ? "[REDACTED]"
  : redact(value);
const jsonBody = async (response: Response, path: string) => {
  if (!response.headers.get("content-type")?.includes("application/json")) return null;
  try { return logSafeBody(path, JSON.parse(await response.clone().text())); } catch { return null; }
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

export type AuthAppDependencies = { tokens: JwtTokenService; service: AuthService };

export function createApp(records: RecordRepository, media: PostgresMediaRepository, queue: RecordPostprocessQueue, oss: OssStorage, creationRead?: CreationReadRepository, creationProposals?: CreationProposalRepository, memory?: Pick<MemoryService, "searchRecords" | "removeRecord">, preferences?: PreferenceService, auth?: AuthAppDependencies) {
  const app = new Hono();
  app.onError((error, c) => {
    logError("http", "Unhandled request error", { method: c.req.method, path: c.req.path, error: error.message });
    return c.json({ success: false, errorCode: "INTERNAL_ERROR", errorMsg: "Internal server error" }, 500);
  });
  app.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "X-Client-Fingerprint", "X-Trace-Id"], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
  app.use("/api/*", async (c, next) => {
    const requestBody = c.req.header("content-type")?.includes("application/json")
      ? await c.req.raw.clone().json().then(value => logSafeBody(c.req.path, value)).catch(() => null)
      : null;
    await next();
    logAccess({ method: c.req.method, path: c.req.path, requestBody, responseBody: await jsonBody(c.res, c.req.path), status: c.res.status });
  });
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const publicAuth = new Set([
      "/api/auth/intents",
      "/api/auth/registrations",
      "/api/auth/logins",
      "/api/auth/tokens/refresh",
    ]);
    if (publicAuth.has(c.req.path)) return next();
    if (!auth) return c.json({ success: false, result: null, errorCode: "UNAUTHENTICATED", errorMsg: "Authentication is not configured" }, 401);
    const token = bearerToken(c.req.raw);
    if (!token) return c.json({ success: false, result: null, errorCode: "UNAUTHENTICATED", errorMsg: "Missing access token" }, 401);
    try {
      const principal = await auth.tokens.verifyAccess(token, "fanto-api");
      await auth.service.assertActiveUser(principal.userId);
      await runWithRequestPrincipal({ userId: principal.userId, token }, next);
    } catch (cause) {
      if (cause instanceof AuthError) {
        return c.json({ success: false, result: null, errorCode: cause.code, errorMsg: cause.message }, cause.status);
      }
      throw cause;
    }
  });
  app.get("/health", c => c.json({ status: "ok", timestamp: nowIso() }));
  if (auth) app.route("/api", createAuthRoutes(auth.service));
  app.route("/api/uploads", createUploadRoutes(media, oss));
  app.route("/api/records", createRecordRoutes(records, media, queue, memory));
  if (preferences) app.route("/api/preferences", createPreferenceRoutes(preferences));
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
