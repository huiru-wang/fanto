import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { streamAudioTranscription } from "../application/media/transcribe-audio.js";
import type { OssStorage } from "../infrastructure/oss-storage.js";
import type { SqliteMediaRepository } from "../infrastructure/repositories/sqlite-media.repository.js";

const createInput = z.object({ fileName: z.string().min(1).max(200), mediaType: z.enum(["image", "audio"]), mimeType: z.string(), bytes: z.number().int().positive().max(50_000_000) }).strict();
const capture = z.object({ width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), durationMs: z.number().int().positive().optional() }).strict().optional();
const mimes = { image: ["image/jpeg", "image/png", "image/webp"], audio: ["audio/mp4", "audio/mpeg", "audio/wav"] } as const;
const userId = (request: Request) => request.headers.get("x-user-id") ?? "default-user";

export function createUploadRoutes(media: SqliteMediaRepository, oss: OssStorage, ai: { apiKey: string; baseUrl: string }) {
  const app = new Hono(); const active = new Set<string>();
  app.post("/intents", async c => {
    const input = createInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success || !mimes[input.data!.mediaType].includes(input.data!.mimeType as never)) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Unsupported media" }, 400);
    const currentUser = userId(c.req.raw); const fileName = input.data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const intent = await media.createIntent({ userId: currentUser, objectKey: `users/${currentUser}/uploads/${crypto.randomUUID()}/${fileName}`, mediaType: input.data.mediaType, mimeType: input.data.mimeType, bytes: input.data.bytes, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
    return c.json({ success: true, result: { intentId: intent.id, uploadUrl: oss.putUrl(intent.object_key), expiresAt: intent.expires_at }, errorCode: null, errorMsg: null }, 201);
  });
  app.post("/intents/:id/complete", async c => {
    const currentUser = userId(c.req.raw); const input = z.object({ capture }).strict().safeParse(await c.req.json().catch(() => ({})));
    if (!input.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid capture" }, 400);
    const intent = await media.getIntent(c.req.param("id"), currentUser);
    if (!intent) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Upload intent not found" }, 404);
    try {
      const head: any = await oss.head(intent.object_key); const bytes = Number(head.res?.headers?.["content-length"] ?? head.res?.headers?.["Content-Length"]); const mimeType = head.res?.headers?.["content-type"] ?? head.res?.headers?.["Content-Type"];
      if (bytes !== intent.bytes || mimeType !== intent.mime_type) return c.json({ success: false, errorCode: "UPLOAD_MISMATCH", errorMsg: "Uploaded object does not match intent" }, 409);
      const result = await media.completeIntent(intent.id, currentUser, { width: input.data.capture?.width ?? null, height: input.data.capture?.height ?? null, durationMs: input.data.capture?.durationMs ?? null });
      if (!result) return c.json({ success: false, errorCode: "UPLOAD_INCOMPLETE", errorMsg: "Upload cannot be completed" }, 409);
      return c.json({ success: true, result, errorCode: null, errorMsg: null });
    } catch { return c.json({ success: false, errorCode: "UPLOAD_INCOMPLETE", errorMsg: "Object was not uploaded" }, 409); }
  });
  app.post("/intents/:id/transcription", async c => {
    const currentUser = userId(c.req.raw); const intent = await media.getIntent(c.req.param("id"), currentUser);
    if (!intent?.media_id || intent.media_type !== "audio") return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Audio upload not found" }, 404);
    if (active.has(intent.id)) return c.json({ success: false, errorCode: "TRANSCRIPTION_ACTIVE", errorMsg: "Transcription already active" }, 409);
    return streamSSE(c, async stream => {
      active.add(intent.id);
      try {
        const result = await streamAudioTranscription({ mediaId: intent.media_id!, userId: currentUser, media, oss, apiKey: ai.apiKey, baseUrl: ai.baseUrl, onDelta: text => stream.writeSSE({ event: "delta", data: JSON.stringify({ text }) }) });
        await stream.writeSSE({ event: "completed", data: JSON.stringify({ transcript: result.transcript || null }) });
      } catch (error) { await stream.writeSSE({ event: "failed", data: JSON.stringify({ message: error instanceof Error ? error.message : "Transcription failed" }) }); } finally { active.delete(intent.id); }
    });
  });
  return app;
}
