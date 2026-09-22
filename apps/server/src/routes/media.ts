import { Hono } from "hono";
import { z } from "zod";
import { mediaMime, mediaObjectKey, normalizeMimeType } from "../domain/media/mime.js";
import type { OssStorage } from "../infrastructure/clients/oss-client.js";
import type { PostgresMediaRepository } from "../domain/media/postgres-repository.js";
import { requireUserId } from "./request-user.js";

const createInput = z.object({ mimeType: z.string().min(1).max(200), bytes: z.number().int().positive().max(50_000_000) }).strict();
const capture = z.object({ width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), durationMs: z.number().int().positive().optional() }).strict().optional();

export function createUploadRoutes(media: PostgresMediaRepository, oss: OssStorage) {
  const app = new Hono();
  app.post("/", async c => {
    const input = createInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Unsupported media" }, 400);
    const descriptor = mediaMime(input.data.mimeType);
    if (!descriptor) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Unsupported media" }, 400);
    const userId = requireUserId(c.req.raw); const mediaId = crypto.randomUUID();
    const created = await media.create({ mediaId, userId, objectKey: mediaObjectKey(userId, mediaId, descriptor.extension), mediaType: descriptor.mediaType, mimeType: descriptor.mimeType, bytes: input.data.bytes });
    return c.json({ success: true, result: { mediaId: created.mediaId, uploadUrl: oss.putUrl(created.objectKey, created.mimeType), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }, errorCode: null, errorMsg: null }, 201);
  });
  app.post("/:id/complete", async c => {
    const userId = requireUserId(c.req.raw); const input = z.object({ capture }).strict().safeParse(await c.req.json().catch(() => ({})));
    if (!input.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid capture" }, 400);
    const current = await media.findMedia(c.req.param("id"), userId);
    if (!current) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404);
    try {
      const head: any = await oss.head(current.objectKey); const bytes = Number(head.res?.headers?.["content-length"] ?? head.res?.headers?.["Content-Length"]); const mimeType = head.res?.headers?.["content-type"] ?? head.res?.headers?.["Content-Type"];
      if (bytes !== current.bytes || normalizeMimeType(mimeType) !== current.mimeType) return c.json({ success: false, errorCode: "UPLOAD_MISMATCH", errorMsg: "Uploaded object does not match media" }, 409);
      const result = await media.complete(current.mediaId, userId, { width: input.data.capture?.width ?? null, height: input.data.capture?.height ?? null, durationMs: input.data.capture?.durationMs ?? null });
      if (!result) return c.json({ success: false, errorCode: "UPLOAD_INCOMPLETE", errorMsg: "Upload cannot be completed" }, 409);
      return c.json({ success: true, result: { mediaId: result.mediaId, mediaType: result.mediaType, mimeType: result.mimeType, bytes: result.bytes, status: result.status }, errorCode: null, errorMsg: null });
    } catch { return c.json({ success: false, errorCode: "UPLOAD_INCOMPLETE", errorMsg: "Object was not uploaded" }, 409); }
  });
  return app;
}
