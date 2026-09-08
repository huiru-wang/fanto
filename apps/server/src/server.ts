import { Hono } from "hono";
import { cors } from "hono/cors";
import type { RecordRepository } from "./modules/record/record.repository.js";
import { createRecordRoutes } from "./routes/records.js";
import { nowIso } from "./infrastructure/time.js";
import type { SqliteMediaRepository } from "./infrastructure/repositories/sqlite-media.repository.js";
import type { OssStorage } from "./infrastructure/oss-storage.js";
import { createUploadRoutes } from "./routes/uploads.js";
export function createApp(records: RecordRepository, media: SqliteMediaRepository, oss: OssStorage, ai: { apiKey: string; baseUrl: string }) { const app = new Hono(); app.use("*", cors()); app.get("/health", c => c.json({ status: "ok", timestamp: nowIso() })); app.route("/api/records", createRecordRoutes(records, media)); app.route("/api/uploads", createUploadRoutes(media, oss, ai)); app.delete("/api/media/:id", async c => { const asset = await media.deleteUnassociatedMedia(c.req.param("id"), c.req.header("x-user-id") ?? "default-user"); if (!asset) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404); try { await oss.remove(asset.objectKey); } catch (error) { console.error("[media] object cleanup failed", error); } return c.body(null, 204); }); app.get("/api/media/:id", async c => { const asset = await media.findMedia(c.req.param("id"), c.req.header("x-user-id") ?? "default-user"); return asset ? c.redirect(oss.readUrl(asset.objectKey), 302) : c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404); }); return app; }
