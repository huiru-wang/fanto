import { Hono } from "hono";
import { z } from "zod";
import { parseSaveRecord } from "../domain/record-content.js";
import type { LocalMediaQueue } from "../infrastructure/local-media-queue.js";
import type { SqliteMediaRepository } from "../infrastructure/repositories/sqlite-media.repository.js";
import { decodeRecordCursor, encodeRecordCursor } from "../modules/record/record-cursor.js";
import type { RecordRepository } from "../modules/record/record.repository.js";
import { requireUserId } from "../interfaces/request-user.js";

const media = z.array(z.unknown());
const createInput = z.object({ text: z.string(), media, source: z.string().max(100).optional() }).strict();
const updateInput = z.object({ text: z.string(), media, expectedVersion: z.number().int().positive() }).strict();
const saveValue = (body: { text: string; media: unknown[] }) => parseSaveRecord({ text: body.text, media: body.media });

async function view(record: any, media: SqliteMediaRepository) {
  const assets = await media.findMediaByIds(record.content.blocks.map((block: any) => block.mediaId), record.userId); const byId = new Map(assets.map(asset => [asset.mediaId, asset]));
  return { ...record, media: record.content.blocks.flatMap((block: any) => { const asset = byId.get(block.mediaId); if (!asset) return []; const capture = asset.extData.capture as { durationMs?: number | null } | undefined; return [block.type === "image" ? { mediaId: asset.mediaId, type: "image", url: `/api/media/${asset.mediaId}`, description: block.description ?? null } : { mediaId: asset.mediaId, type: "audio", url: `/api/media/${asset.mediaId}`, durationMs: capture?.durationMs ?? null }]; }) };
}
function publishImages(queue: LocalMediaQueue, record: any) { for (const block of record.content.blocks) if (block.type === "image" && !block.description) queue.publish("image_understanding", { recordId: record.id, userId: record.userId, mediaId: block.mediaId, version: record.version }); }
function error(c: any, value: string, current?: unknown) { if (value === "not_found") return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Record not found" }, 404); if (value === "conflict") return c.json({ success: false, result: current ?? null, errorCode: "VERSION_CONFLICT", errorMsg: "Record was changed by another edit" }, 409); if (value === "invalid_content") return c.json({ success: false, errorCode: "INVALID_CONTENT", errorMsg: "Record requires text or audio" }, 400); return c.json({ success: false, errorCode: "INVALID_MEDIA", errorMsg: "Media is missing, not ready, belongs to another user, or already linked" }, 400); }

export function createRecordRoutes(records: RecordRepository, media: SqliteMediaRepository, queue: LocalMediaQueue) {
  const app = new Hono();
  app.post("/", async c => { const body = createInput.safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400); try { const record = await records.create({ userId: requireUserId(c.req.raw), source: body.data.source, value: saveValue(body.data) }); if (typeof record === "string") return error(c, record); publishImages(queue, record); return c.json({ success: true, result: await view(record, media), errorCode: null, errorMsg: null }, 201); } catch (cause) { return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: cause instanceof Error ? cause.message : "Invalid record" }, 400); } });
  app.patch("/:id", async c => { const body = updateInput.safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: body.error.message }, 400); const currentUser = requireUserId(c.req.raw); try { const record = await records.updateContent(c.req.param("id"), currentUser, { value: saveValue(body.data), expectedVersion: body.data.expectedVersion }); if (record === "conflict") { const current = await records.findById(c.req.param("id")); return error(c, record, current?.userId === currentUser ? await view(current, media) : null); } if (typeof record === "string") return error(c, record); publishImages(queue, record); return c.json({ success: true, result: await view(record, media), errorCode: null, errorMsg: null }); } catch (cause) { return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: cause instanceof Error ? cause.message : "Invalid record" }, 400); } });
  app.get("/", async c => { const cursor = c.req.query("cursor"); try { if (cursor) decodeRecordCursor(cursor); } catch { return c.json({ success: false, errorCode: "INVALID_CURSOR", errorMsg: "Invalid record cursor" }, 400); } const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 100); const rows = await records.findByUserId(requireUserId(c.req.raw), { cursor, limit: limit + 1 }); const data = await Promise.all(rows.slice(0, limit).map(record => view(record, media))); return c.json({ success: true, result: { data, hasMore: rows.length > limit, nextCursor: rows.length > limit && data.at(-1) ? encodeRecordCursor(data.at(-1)) : null, pageSize: limit }, errorCode: null, errorMsg: null }); });
  app.get("/:id", async c => { const record = await records.findById(c.req.param("id")); if (!record || record.userId !== requireUserId(c.req.raw)) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Record not found" }, 404); return c.json({ success: true, result: await view(record, media), errorCode: null, errorMsg: null }); });
  return app;
}
