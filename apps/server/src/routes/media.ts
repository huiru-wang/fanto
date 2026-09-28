import { Hono } from "hono";
import { z } from "zod";
import { MediaService } from "../domain/media/index.js";
import { requireUserId } from "./request-user.js";
const createInput = z.object({ mimeType: z.string().min(1).max(200), bytes: z.number().int().positive().max(50_000_000) }).strict();
const capture = z.object({ width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), durationMs: z.number().int().positive().optional() }).strict().optional();
const envelope = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });
export function createUploadRoutes(service: MediaService) { const app = new Hono();
  app.post("/", async c => { const input = createInput.safeParse(await c.req.json().catch(() => null)); if (!input.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Unsupported media" }, 400); const result = await service.createUpload(requireUserId(c.req.raw), input.data); return result ? c.json(envelope(result), 201) : c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Unsupported media" }, 400); });
  app.post("/:id/complete", async c => { const input = z.object({ capture }).strict().safeParse(await c.req.json().catch(() => ({}))); if (!input.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid capture" }, 400); const result = await service.completeUpload(requireUserId(c.req.raw), c.req.param("id"), input.data.capture ?? {}); if (result.kind === "ok") return c.json(envelope({ mediaId: result.media.mediaId, mediaType: result.media.mediaType, mimeType: result.media.mimeType, bytes: result.media.bytes, status: result.media.status })); return c.json({ success: false, errorCode: result.kind === "not_found" ? "NOT_FOUND" : result.kind === "mismatch" ? "UPLOAD_MISMATCH" : "UPLOAD_INCOMPLETE", errorMsg: result.kind === "not_found" ? "Media not found" : result.kind === "mismatch" ? "Uploaded object does not match media" : "Upload cannot be completed" }, result.kind === "not_found" ? 404 : 409); });
  return app;
}
