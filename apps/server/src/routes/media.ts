import { Hono } from "hono";
import { z } from "zod";
import { MediaService } from "../domain/media/index.js";
import { requireUserId } from "./request-user.js";
const createInput = z.object({ mimeType: z.string().min(1).max(200), bytes: z.number().int().positive().max(50_000_000), purpose: z.enum(["record","fanto_avatar"]).optional() }).strict();
const capture = z.object({ width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), durationMs: z.number().int().positive().optional() }).strict().optional();
const envelope = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });
export function createUploadRoutes(service: MediaService) { const app = new Hono();
  app.post("/", async c => { const input = createInput.safeParse(await c.req.json().catch(() => null)); if (!input.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Unsupported media" }, 400); if (input.data.purpose === "fanto_avatar" && input.data.bytes > 512*1024) return c.json({success:false,errorCode:"IMAGE_TOO_LARGE",errorMsg:"头像不能超过 512KB"},413); if (input.data.mimeType.startsWith("image/") && input.data.bytes > 10 * 1024 * 1024) return c.json({ success: false, errorCode: "IMAGE_TOO_LARGE", errorMsg: "图片不能超过 10MB" }, 413); const result = await service.createUpload(requireUserId(c.req.raw), input.data); return result ? c.json(envelope(result), 201) : c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Unsupported media" }, 400); });
  app.post("/:id/complete", async c => { const input = z.object({ capture }).strict().safeParse(await c.req.json().catch(() => ({}))); if (!input.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid capture" }, 400); const result = await service.completeUpload(requireUserId(c.req.raw), c.req.param("id"), input.data.capture ?? {}); if (result.kind === "ok") return c.json(envelope({ mediaId: result.media.mediaId, mediaType: result.media.mediaType, mimeType: result.media.mimeType, bytes: result.media.bytes, status: result.media.status })); const error = result.kind === "not_found" ? { code: "NOT_FOUND", status: 404 as const }
    : result.kind === "not_uploaded" ? { code: "UPLOAD_NOT_FOUND", status: 409 as const }
    : result.kind === "mismatch" ? { code: "UPLOAD_MISMATCH", status: 409 as const }
    : result.kind === "invalid_avatar" ? { code: "INVALID_AVATAR_IMAGE", status: 422 as const }
    : result.kind === "invalid_image" ? { code: "INVALID_IMAGE", status: 422 as const }
    : { code: "UPLOAD_INCOMPLETE", status: 409 as const };
    return c.json({ success: false, errorCode: error.code, errorMsg: "保存失败，请重试" }, error.status); });
  return app;
}
