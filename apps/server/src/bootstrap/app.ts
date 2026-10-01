import { Hono } from "hono";
import { cors } from "hono/cors";
import { nowIso } from "../infrastructure/time.js";
import { createRecordRoutes } from "../routes/records.js";
import { createUploadRoutes } from "../routes/media.js";
import { bearerToken, requireUserId, runWithRequestPrincipal } from "../routes/request-user.js";
import { AuthError, type AuthService } from "../domain/auth/index.js";
import { createAuthRoutes } from "../routes/auth.js";
import { logAccess, logError } from "../infrastructure/logging/logger.js";
import { createProjectRoutes } from "../routes/projects.js";
import type { PreferenceService } from "../domain/preferences/index.js";
import { createPreferenceRoutes } from "../routes/preferences.js";
import { RecordService } from "../domain/records/index.js";
import { MediaService } from "../domain/media/index.js";
import type { ProjectService } from "../domain/projects/index.js";
import type { TaskService } from "../domain/tasks/index.js";
import type { AgentRuntime } from "../agent/agent-runtime.js";
import { createSessionRoutes } from "../routes/agent/sessions.js";
import { createAgentRoutes } from "../routes/agent/stream.js";
import { createTaskRoutes } from "../routes/tasks.js";
import { bodyLimit } from "hono/body-limit";

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

export type ServerServices = {
  auth?: AuthService;
  records: RecordService;
  media: MediaService;
  preferences?: PreferenceService;
  projects?: ProjectService;
  tasks?: TaskService;
  agent?: AgentRuntime;
  healthCheck?: () => Promise<void>;
};

export function createApp(services: ServerServices) {
  const app = new Hono();
  const { auth, records: recordService, media: mediaService, preferences, projects: projectService } = services;
  app.onError((error, c) => {
    logError("http", "Unhandled request error", { method: c.req.method, path: c.req.path, error: error.message });
    return c.json({ success: false, errorCode: "INTERNAL_ERROR", errorMsg: "Internal server error" }, 500);
  });
  app.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "X-Client-Fingerprint", "X-Trace-Id", "X-Time-Zone"], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
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
      "/api/auth/authentications",
      "/api/auth/registrations",
      "/api/auth/logins",
      "/api/auth/tokens/refresh",
    ]);
    if (publicAuth.has(c.req.path)) return next();
    if (!auth) return c.json({ success: false, result: null, errorCode: "UNAUTHENTICATED", errorMsg: "Authentication is not configured" }, 401);
    const token = bearerToken(c.req.raw);
    if (!token) return c.json({ success: false, result: null, errorCode: "UNAUTHENTICATED", errorMsg: "Missing access token" }, 401);
    try {
      const principal = await auth.verifyAccess(token, "fanto-api");
      await auth.assertActiveUser(principal.userId);
      await runWithRequestPrincipal({ userId: principal.userId, source: "user" }, next);
    } catch (cause) {
      if (cause instanceof AuthError) {
        return c.json({ success: false, result: null, errorCode: cause.code, errorMsg: cause.message }, cause.status);
      }
      throw cause;
    }
  });
  app.get("/health", async c => {
    try {
      await services.healthCheck?.();
      return c.json({ status: "ok", database: "ok", timestamp: nowIso() });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      logError("health", "Health check failed", { error: error.message });
      return c.json({ status: "unavailable", database: "unavailable", timestamp: nowIso() }, 503);
    }
  });
  if (auth) app.route("/api", createAuthRoutes(auth));
  app.route("/api/uploads", createUploadRoutes(mediaService));
  app.route("/api/records", createRecordRoutes(recordService));
  if (preferences) app.route("/api/preferences", createPreferenceRoutes(preferences));
  if (projectService) app.route("/api", createProjectRoutes(projectService));
  if (services.tasks) app.route("/api", createTaskRoutes(services.tasks, mediaService));
  if (services.agent) {
    app.use("/api/agent/*", bodyLimit({ maxSize: 64 * 1024 }));
    app.route("/api/agent", createSessionRoutes(services.agent.registry, services.agent.sessions));
    app.route("/api/agent", createAgentRoutes(services.agent.registry, services.agent.sessions));
  }
  app.get("/api/media/:id/meta", async c => {
    const result = await mediaService.readyMetadata(requireUserId(c.req.raw), c.req.param("id"));
    return result
      ? c.json({ success: true, result, errorCode: null, errorMsg: null })
      : c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404);
  });
  app.get("/api/media/:id/url", async c => {
    const variant = c.req.query("variant") ?? "original";
    if (variant !== "thumbnail" && variant !== "original") {
      return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid media variant" }, 400);
    }
    const result = await mediaService.readUrl(requireUserId(c.req.raw), c.req.param("id"), variant);
    return result
      ? c.json({ success: true, result, errorCode: null, errorMsg: null })
      : c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404);
  });
  app.get("/api/media/:id", async c => { const url = await mediaService.redirectUrl(requireUserId(c.req.raw), c.req.param("id")); return url ? c.redirect(url, 302) : c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404); });
  return app;
}
