import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { streamAudioTranscription } from "../application/media/transcribe-audio.js";
import type { OssStorage } from "../infrastructure/oss-storage.js";
import type { SqliteMediaRepository } from "../infrastructure/repositories/sqlite-media.repository.js";
import { requireUserId } from "../interfaces/request-user.js";

const createInput = z.object({ fileName: z.string().min(1).max(200), mediaType: z.enum(["image", "audio"]), mimeType: z.string(), bytes: z.number().int().positive().max(50_000_000) }).strict();
const capture = z.object({ width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), durationMs: z.number().int().positive().optional() }).strict().optional();
const mimes = { image: ["image/jpeg", "image/png", "image/webp"], audio: ["audio/mp4", "audio/mpeg", "audio/wav"] } as const;

export function createUploadRoutes(media: SqliteMediaRepository, oss: OssStorage, ai: { apiKey: string; asrBaseUrl: string }) {
  const app = new Hono(); const active = new Set<string>();
  app.post("/", async c => {
    const input = createInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success || !mimes[input.data!.mediaType].includes(input.data!.mimeType as never)) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Unsupported media" }, 400);
    const userId = requireUserId(c.req.raw); const fileName = input.data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const created = await media.create({ userId, objectKey: `users/${userId}/uploads/${crypto.randomUUID()}/${fileName}`, mediaType: input.data.mediaType, mimeType: input.data.mimeType, bytes: input.data.bytes });
    return c.json({ success: true, result: { mediaId: created.mediaId, uploadUrl: oss.putUrl(created.objectKey, created.mimeType), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }, errorCode: null, errorMsg: null }, 201);
  });
  app.post("/:id/complete", async c => {
    const userId = requireUserId(c.req.raw); const input = z.object({ capture }).strict().safeParse(await c.req.json().catch(() => ({})));
    if (!input.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid capture" }, 400);
    const current = await media.findMedia(c.req.param("id"), userId);
    if (!current) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Media not found" }, 404);
    try {
      const head: any = await oss.head(current.objectKey); const bytes = Number(head.res?.headers?.["content-length"] ?? head.res?.headers?.["Content-Length"]); const mimeType = head.res?.headers?.["content-type"] ?? head.res?.headers?.["Content-Type"];
      if (bytes !== current.bytes || mimeType !== current.mimeType) return c.json({ success: false, errorCode: "UPLOAD_MISMATCH", errorMsg: "Uploaded object does not match media" }, 409);
      const result = await media.complete(current.mediaId, userId, { width: input.data.capture?.width ?? null, height: input.data.capture?.height ?? null, durationMs: input.data.capture?.durationMs ?? null });
      if (!result) return c.json({ success: false, errorCode: "UPLOAD_INCOMPLETE", errorMsg: "Upload cannot be completed" }, 409);
      return c.json({ success: true, result: { mediaId: result.mediaId, mediaType: result.mediaType, mimeType: result.mimeType, bytes: result.bytes, status: result.status }, errorCode: null, errorMsg: null });
    } catch { return c.json({ success: false, errorCode: "UPLOAD_INCOMPLETE", errorMsg: "Object was not uploaded" }, 409); }
  });
  app.post("/:id/transcription", async c => {
    const userId = requireUserId(c.req.raw); const current = await media.findMedia(c.req.param("id"), userId);
    if (!current || current.status !== "ready" || current.mediaType !== "audio") return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Audio media not found" }, 404);
    const saved = current.extData.asr as { status?: string; transcript?: string } | undefined;
    if (saved?.status === "succeeded") return streamSSE(c, async stream => { await stream.writeSSE({ event: "completed", data: JSON.stringify({ transcript: saved.transcript ?? null }) }); });
    if (active.has(current.mediaId)) return c.json({ success: false, errorCode: "TRANSCRIPTION_ACTIVE", errorMsg: "Transcription already active" }, 409);
    return streamSSE(c, async stream => {
      active.add(current.mediaId);
      try {
        await media.updateAsr(current.mediaId, userId, { status: "running", model: "qwen3-asr-flash" });
        const result = await streamAudioTranscription({ mediaId: current.mediaId, userId, media, oss, apiKey: ai.apiKey, baseUrl: ai.asrBaseUrl, onDelta: text => stream.writeSSE({ event: "delta", data: JSON.stringify({ text }) }) });
        await media.updateAsr(current.mediaId, userId, { status: "succeeded", transcript: result.transcript, model: "qwen3-asr-flash", completedAt: new Date().toISOString() });
        await stream.writeSSE({ event: "completed", data: JSON.stringify({ transcript: result.transcript || null }) });
      } catch (error) { await media.updateAsr(current.mediaId, userId, { status: "failed", errorCode: "TRANSCRIPTION_FAILED" }); await stream.writeSSE({ event: "failed", data: JSON.stringify({ message: error instanceof Error ? error.message : "Transcription failed" }) }); } finally { active.delete(current.mediaId); }
    });
  });
  return app;
}
